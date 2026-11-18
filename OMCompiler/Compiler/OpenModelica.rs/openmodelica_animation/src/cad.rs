//! Host-independent CAD readers for compiler-exported animation resources.
//!
//! Coordinates remain in the file's frame and units. The scene applies the
//! Modelica transform and optional x/y/z scaling, exactly as for native CAD.
//! Invalid or missing meshes are errors; no replacement geometry is generated.

use std::collections::HashMap;
use crate::jslab::Mesh;

pub type Resources = HashMap<String, Vec<u8>>;

fn number(text: &str) -> Result<f32, String> {
    text.parse::<f32>().ok().filter(|value| value.is_finite())
        .ok_or_else(|| format!("Invalid CAD coordinate: {text}"))
}

fn text(bytes: &[u8]) -> Result<&str, String> {
    std::str::from_utf8(bytes).map_err(|_| "The CAD text is not UTF-8.".into())
}

fn color24(value: u32) -> [f32; 3] {
    [(value >> 16 & 255) as f32, (value >> 8 & 255) as f32, (value & 255) as f32]
}

fn triangle(mesh: &mut Mesh, points: [[f32; 3]; 3], color: Option<[f32; 3]>) {
    let offset = mesh.vertices.len() as u32;
    mesh.vertices.extend(points);
    mesh.triangles.push([offset, offset + 1, offset + 2]);
    mesh.colors.push(color);
}

/// Relative material resources follow the CAD file, including URI paths.
pub fn relative_resource(base: &str, name: &str) -> Result<String, String> {
    if name.contains("://") || name.starts_with('/') || name.contains('\\') {
        return Err("A CAD material must use a relative resource path.".into());
    }
    let parent = base.rsplit_once('/').map(|pair| pair.0).unwrap_or("");
    let mut parts: Vec<&str> = if parent.is_empty() { Vec::new() } else { parent.split('/').collect() };
    let protected = if base.contains("://") { 3 } else { 0 };
    for part in name.split('/') {
        match part {
            "" | "." => {},
            ".." => { if parts.len() <= protected { return Err("The CAD material path escapes its resource root.".into()); } parts.pop(); },
            _ => parts.push(part),
        }
    }
    Ok(parts.join("/"))
}

/// OBJ material files are resources too; hosts collect them before construction.
pub fn dependencies(name: &str, bytes: &[u8]) -> Result<Vec<String>, String> {
    if !name.to_ascii_lowercase().ends_with(".obj") { return Ok(Vec::new()); }
    let mut result = Vec::new();
    for line in text(bytes)?.lines() {
        let line = line.split('#').next().unwrap_or("").trim();
        if let Some(names) = line.strip_prefix("mtllib ") {
            for value in names.split_whitespace() {
                let resource = relative_resource(name, value)?;
                if !result.contains(&resource) { result.push(resource); }
            }
        }
    }
    Ok(result)
}

pub fn parse(name: &str, resources: &Resources) -> Result<Mesh, String> {
    let bytes = resources.get(name).ok_or_else(|| format!("Missing CAD resource: {name}"))?;
    let suffix = if !name.is_empty() && name.bytes().all(|value| value.is_ascii_digit()) { "dxf".into() }
        else { name.rsplit('.').next().unwrap_or("").to_ascii_lowercase() };
    let mesh = match suffix.as_str() {
        "dxf" => dxf(bytes),
        "stl" => stl(bytes),
        "obj" => obj(name, bytes, resources),
        "3ds" => three_ds(bytes),
        _ => Err(format!("Unsupported CAD format: {name}")),
    }?;
    if mesh.triangles.is_empty() || mesh.vertices.iter().flatten().any(|value| !value.is_finite()) {
        return Err(format!("The CAD resource contains no valid finite mesh: {name}"));
    }
    Ok(mesh)
}

/// DXF 3DFACE entities with direct colors, true colors and layer color lookup.
fn dxf(bytes: &[u8]) -> Result<Mesh, String> {
    let lines: Vec<_> = text(bytes)?.lines().map(str::trim).collect();
    if lines.len() % 2 != 0 { return Err("The DXF group/value stream is incomplete.".into()); }
    let mut entities: Vec<(String, Vec<(u16, &str)>)> = Vec::new();
    for pair in lines.chunks_exact(2) {
        let code = pair[0].parse::<u16>().map_err(|_| "Invalid DXF group code.")?;
        if code == 0 { entities.push((pair[1].into(), Vec::new())); }
        else if let Some((_, values)) = entities.last_mut() { values.push((code, pair[1])); }
    }
    let aci = |value: &str| -> Result<[f32; 3], String> {
        let code = value.parse::<i32>().map_err(|_| "Invalid DXF color index.")?.abs();
        if code > 255 { return Err("Invalid DXF color index.".into()); }
        Ok(crate::dxf::aci_rgb(code).map(|value| value * 255.0))
    };
    let mut layers = HashMap::new();
    for (kind, values) in &entities {
        if kind != "LAYER" { continue; }
        let name = values.iter().find(|(code, _)| *code == 2).map(|(_, value)| *value).unwrap_or("0");
        if let Some((_, value)) = values.iter().find(|(code, _)| *code == 62) { layers.insert(name, aci(value)?); }
    }
    let mut mesh = Mesh::default();
    for (kind, values) in entities {
        if kind != "3DFACE" { continue; }
        let mut points = [[None; 3]; 4];
        let mut color = None;
        let mut true_color = None;
        let mut layer = "0";
        for (code, value) in values {
            match code {
                10..=13 | 20..=23 | 30..=33 => {
                    points[(code % 10) as usize][(code / 10 - 1) as usize] = Some(number(value)?);
                },
                8 => layer = value,
                62 if value != "256" => color = Some(aci(value)?),
                420 => true_color = Some(color24(value.parse::<u32>().map_err(|_| "Invalid DXF true color.")?)),
                _ => {},
            }
        }
        let mut vertices = [[0.0; 3]; 4];
        for corner in 0..3 { for axis in 0..3 {
            vertices[corner][axis] = points[corner][axis].ok_or("Incomplete DXF face coordinates.")?;
        } }
        // The fourth corner is optional for triangular faces. Both conventions
        // found in Modelica resources (fourth == first or third) are accepted.
        if points[3].iter().all(Option::is_none) { vertices[3] = vertices[2]; }
        else { for axis in 0..3 { vertices[3][axis] = points[3][axis].ok_or("Incomplete DXF fourth corner.")?; } }
        let color = true_color.or(color).or(layers.get(layer).copied());
        triangle(&mut mesh, [vertices[0], vertices[1], vertices[2]], color);
        if vertices[3] != vertices[0] && vertices[3] != vertices[2] {
            triangle(&mut mesh, [vertices[0], vertices[2], vertices[3]], color);
        }
    }
    Ok(mesh)
}

fn u16_at(bytes: &[u8], offset: usize) -> Result<u16, String> {
    Ok(u16::from_le_bytes(bytes.get(offset..offset+2).ok_or("Truncated CAD data.")?.try_into().unwrap()))
}
fn u32_at(bytes: &[u8], offset: usize) -> Result<u32, String> {
    Ok(u32::from_le_bytes(bytes.get(offset..offset+4).ok_or("Truncated CAD data.")?.try_into().unwrap()))
}
fn f32_at(bytes: &[u8], offset: usize) -> Result<f32, String> {
    let value = f32::from_bits(u32_at(bytes, offset)?);
    if !value.is_finite() { return Err("Non-finite CAD coordinate.".into()); }
    Ok(value)
}

/// Detect binary STL by its declared byte length, even when its header is solid.
fn stl(bytes: &[u8]) -> Result<Mesh, String> {
    let mut mesh = Mesh::default();
    if bytes.len() >= 84 {
        let count = u32_at(bytes, 80)? as usize;
        if count.checked_mul(50).and_then(|n| n.checked_add(84)) == Some(bytes.len()) {
            for face in 0..count {
                let start = 84 + face * 50 + 12;
                let mut points = [[0.0; 3]; 3];
                for corner in 0..3 { for axis in 0..3 {
                    points[corner][axis] = f32_at(bytes, start + corner * 12 + axis * 4)?;
                } }
                let attribute = u16_at(bytes, start + 36)?;
                let color = (attribute & 0x8000 != 0).then(|| [
                    ((attribute >> 10) & 31) as f32 * 255.0 / 31.0,
                    ((attribute >> 5) & 31) as f32 * 255.0 / 31.0,
                    (attribute & 31) as f32 * 255.0 / 31.0]);
                triangle(&mut mesh, points, color);
            }
            return Ok(mesh);
        }
    }
    let input = text(bytes)?;
    if !input.trim_start().starts_with("solid") { return Err("Invalid or truncated STL data.".into()); }
    let mut points = Vec::new();
    let mut active = false;
    for line in input.lines() {
        let parts: Vec<_> = line.split_whitespace().collect();
        match parts.first().copied().unwrap_or("") {
            "facet" => { if active { return Err("Unclosed STL facet.".into()); } active = true; points.clear(); },
            "vertex" => {
                if !active || parts.len() != 4 || points.len() >= 3 { return Err("Invalid STL vertex.".into()); }
                points.push([number(parts[1])?, number(parts[2])?, number(parts[3])?]);
            },
            "endfacet" => {
                if !active || points.len() != 3 { return Err("Incomplete STL facet.".into()); }
                triangle(&mut mesh, [points[0], points[1], points[2]], None); active = false;
            },
            _ => {},
        }
    }
    if active { return Err("Unclosed STL facet.".into()); }
    Ok(mesh)
}

fn obj(name: &str, bytes: &[u8], resources: &Resources) -> Result<Mesh, String> {
    let mut materials = HashMap::new();
    for dependency in dependencies(name, bytes)? {
        let data = resources.get(&dependency).ok_or_else(|| format!("Missing CAD material: {dependency}"))?;
        let mut current = String::new();
        for line in text(data)?.lines() {
            let parts: Vec<_> = line.split('#').next().unwrap_or("").split_whitespace().collect();
            match parts.first().copied().unwrap_or("") {
                "newmtl" => current = parts[1..].join(" "),
                "Kd" if parts.len() == 4 && !current.is_empty() => {
                    materials.insert(current.clone(), [number(parts[1])?, number(parts[2])?, number(parts[3])?].map(|v| v.clamp(0.0,1.0) * 255.0));
                },
                _ => {},
            }
        }
    }
    let mut vertices = Vec::new();
    let mut mesh = Mesh::default();
    let mut material = String::new();
    for line in text(bytes)?.lines() {
        let parts: Vec<_> = line.split('#').next().unwrap_or("").split_whitespace().collect();
        match parts.first().copied().unwrap_or("") {
            "v" => {
                if parts.len() < 4 { return Err("Incomplete OBJ vertex.".into()); }
                let weight = if parts.len() == 5 { number(parts[4])? } else { 1.0 };
                if weight == 0.0 { return Err("Invalid homogeneous OBJ vertex.".into()); }
                vertices.push([number(parts[1])? / weight, number(parts[2])? / weight, number(parts[3])? / weight]);
            },
            "usemtl" => material = parts[1..].join(" "),
            "f" => {
                if parts.len() < 4 { return Err("An OBJ face needs three vertices.".into()); }
                let mut polygon = Vec::new();
                for part in &parts[1..] {
                    let index = part.split('/').next().unwrap_or("").parse::<i64>().map_err(|_| "Invalid OBJ face index.")?;
                    let offset = if index < 0 { vertices.len() as i64 + index } else { index - 1 };
                    if index == 0 || offset < 0 { return Err("OBJ face index is out of range.".into()); }
                    polygon.push(*vertices.get(offset as usize).ok_or("OBJ face index is out of range.")?);
                }
                for face in triangulate(&polygon)? { triangle(&mut mesh, face, materials.get(&material).copied()); }
            },
            _ => {},
        }
    }
    Ok(mesh)
}

/// Ear clipping preserves concave planar OBJ faces, unlike triangle fans.
fn triangulate(points: &[[f32; 3]]) -> Result<Vec<[[f32; 3]; 3]>, String> {
    let mut normal = [0.0_f64; 3];
    for i in 0..points.len() { let a = points[i]; let b = points[(i+1)%points.len()];
        for axis in 0..3 { normal[axis] += (a[(axis+1)%3] - b[(axis+1)%3]) as f64 * (a[(axis+2)%3] + b[(axis+2)%3]) as f64; }
    }
    let drop = (0..3).max_by(|&a,&b| normal[a].abs().total_cmp(&normal[b].abs())).unwrap();
    if normal[drop] == 0.0 { return Err("Degenerate OBJ polygon.".into()); }
    let p: Vec<[f64;2]> = points.iter().map(|v| [v[(drop+1)%3] as f64,v[(drop+2)%3] as f64]).collect();
    let cross = |a: usize,b: usize,c: usize| (p[b][0]-p[a][0])*(p[c][1]-p[a][1])-(p[b][1]-p[a][1])*(p[c][0]-p[a][0]);
    let sign = normal[drop].signum();
    let mut indices: Vec<_> = (0..points.len()).collect(); let mut faces = Vec::new();
    while indices.len() > 3 {
        let mut found = None;
        for i in 0..indices.len() {
            let a = indices[(i+indices.len()-1)%indices.len()]; let b = indices[i]; let c = indices[(i+1)%indices.len()];
            if cross(a,b,c)*sign <= 0.0 { continue; }
            if indices.iter().any(|&v| v != a && v != b && v != c && cross(a,b,v)*sign >= 0.0 && cross(b,c,v)*sign >= 0.0 && cross(c,a,v)*sign >= 0.0) { continue; }
            faces.push([points[a],points[b],points[c]]); found = Some(i); break;
        }
        indices.remove(found.ok_or("Invalid or self-intersecting OBJ polygon.")?);
    }
    faces.push([points[indices[0]],points[indices[1]],points[indices[2]]]);
    Ok(faces)
}

/// 3DS triangle meshes, object transforms and diffuse material assignments.
fn three_ds(bytes: &[u8]) -> Result<Mesh, String> {
    if u16_at(bytes,0)? != 0x4d4d { return Err("Invalid 3DS file header.".into()); }
    #[derive(Default)] struct Object { vertices: Vec<[f32;3]>, faces: Vec<[u32;3]>, groups: HashMap<usize,String>, matrix: Option<[f32;12]> }
    fn string(bytes: &[u8], start: usize) -> Result<(String,usize),String> {
        let count = bytes.get(start..).ok_or("Truncated 3DS name.")?.iter().position(|v| *v == 0).ok_or("Unterminated 3DS name.")?;
        Ok((String::from_utf8_lossy(&bytes[start..start+count]).into_owned(),start+count+1))
    }
    fn chunks(bytes: &[u8]) -> Result<Vec<(u16,&[u8])>,String> {
        let mut result = Vec::new(); let mut offset = 0;
        while offset < bytes.len() {
            let id = u16_at(bytes,offset)?; let size = u32_at(bytes,offset+2)? as usize;
            if size < 6 { return Err("Invalid 3DS chunk size.".into()); }
            let end = offset.checked_add(size).filter(|end| *end <= bytes.len()).ok_or("Truncated 3DS chunk.")?;
            result.push((id,&bytes[offset+6..end])); offset = end;
        }
        Ok(result)
    }
    fn read(bytes: &[u8], object: &mut Object, objects: &mut Vec<Object>, materials: &mut HashMap<String,[f32;3]>, depth: usize) -> Result<(),String> {
        if depth > 32 { return Err("Excessively nested 3DS file.".into()); }
        for (id,data) in chunks(bytes)? {
            match id {
                0x4d4d | 0x3d3d | 0x4100 => read(data,object,objects,materials,depth+1)?,
                0x4000 => { let (_,start) = string(data,0)?; let mut child = Object::default(); read(&data[start..],&mut child,objects,materials,depth+1)?; objects.push(child); },
                0x4110 => { let count = u16_at(data,0)? as usize; for i in 0..count { object.vertices.push([f32_at(data,2+i*12)?,f32_at(data,6+i*12)?,f32_at(data,10+i*12)?]); } },
                0x4120 => { let count = u16_at(data,0)? as usize; for i in 0..count { object.faces.push([u16_at(data,2+i*8)? as u32,u16_at(data,4+i*8)? as u32,u16_at(data,6+i*8)? as u32]); }
                    read(data.get(2+count*8..).ok_or("Truncated 3DS faces.")?,object,objects,materials,depth+1)?; },
                0x4130 => { let (name,start) = string(data,0)?; let count = u16_at(data,start)? as usize; for i in 0..count { object.groups.insert(u16_at(data,start+2+i*2)? as usize,name.clone()); } },
                0x4160 => { let mut matrix = [0.0;12]; for i in 0..12 { matrix[i] = f32_at(data,i*4)?; } object.matrix = Some(matrix); },
                0xafff => {
                    let mut name = String::new(); let mut color = None;
                    for (id,data) in chunks(data)? { match id {
                        0xa000 => name = string(data,0)?.0,
                        0xa020 => { for (id,data) in chunks(data)? { match id {
                            0x0010 | 0x0013 => color = Some([f32_at(data,0)?,f32_at(data,4)?,f32_at(data,8)?].map(|v| v.clamp(0.0,1.0)*255.0)),
                            0x0011 | 0x0012 => { if data.len() < 3 { return Err("Truncated 3DS color.".into()); } color = Some([data[0] as f32,data[1] as f32,data[2] as f32]); },
                            _ => {},
                        } } },
                        _ => {},
                    } }
                    if let Some(color) = color { materials.insert(name,color); }
                },
                _ => {},
            }
        }
        Ok(())
    }
    let mut objects = Vec::new(); let mut materials = HashMap::new();
    read(bytes,&mut Object::default(),&mut objects,&mut materials,0)?;
    let mut mesh = Mesh::default();
    for object in objects { for (index,face) in object.faces.iter().enumerate() {
        let mut points = [[0.0;3];3];
        for i in 0..3 { points[i] = *object.vertices.get(face[i] as usize).ok_or("3DS face index is out of range.")?; }
        // Vertices in 3DS files are already in world coordinates. The local
        // matrix describes the object's frame; applying it twice displaces CAD.
        triangle(&mut mesh,points,object.groups.get(&index).and_then(|name| materials.get(name)).copied());
    } }
    Ok(mesh)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_one(name: &str, bytes: Vec<u8>) -> Result<Mesh,String> {
        parse(name,&HashMap::from([(name.into(),bytes)]))
    }

    #[test]
    fn dxf_preserves_layer_and_true_colors_and_both_triangle_conventions() {
        let source = "0\nSECTION\n2\nTABLES\n0\nLAYER\n2\nmetal\n62\n1\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\n3DFACE\n8\nmetal\n10\n1\n20\n0\n30\n0\n11\n2\n21\n0\n31\n0\n12\n1\n22\n3\n32\n0\n13\n1\n23\n3\n33\n0\n0\n3DFACE\n420\n66051\n10\n0\n20\n0\n30\n0\n11\n1\n21\n0\n31\n0\n12\n0\n22\n1\n32\n0\n13\n0\n23\n0\n33\n0\n0\nENDSEC\n0\nEOF\n";
        let mesh = parse_one("test.dxf",source.as_bytes().to_vec()).unwrap();
        assert_eq!(mesh.triangles.len(),2);
        assert_eq!(mesh.vertices[2],[1.0,3.0,0.0]);
        assert_eq!(mesh.colors,vec![Some([255.0,0.0,0.0]),Some([1.0,2.0,3.0])]);
        assert!(parse_one("test.dxf",source.replace("\n3\n","\nNaN\n").into_bytes()).is_err());
        assert!(parse_one("test.dxf",b"0\n3DFACE\n10\n1\n".to_vec()).is_err());
    }

    #[test]
    fn ascii_and_binary_stl_have_identical_vertices_and_bad_lengths_are_rejected() {
        let ascii = b"solid mesh\nfacet normal 0 0 1\nouter loop\nvertex 1 0 0\nvertex 0 2 0\nvertex 0 0 3\nendloop\nendfacet\nendsolid mesh\n";
        let mut binary = vec![0;84]; binary[..5].copy_from_slice(b"solid"); binary[80..84].copy_from_slice(&1u32.to_le_bytes());
        for value in [0.0_f32,0.0,1.0,1.0,0.0,0.0,0.0,2.0,0.0,0.0,0.0,3.0] { binary.extend(value.to_le_bytes()); }
        binary.extend(0xfc00u16.to_le_bytes());
        let a = parse_one("part.stl",ascii.to_vec()).unwrap(); let b = parse_one("part.stl",binary.clone()).unwrap();
        assert_eq!(a.vertices,b.vertices); assert_eq!(b.colors,[Some([255.0,0.0,0.0])]);
        binary.pop(); assert!(parse_one("part.stl",binary).is_err());
        assert!(parse_one("part.stl",b"solid\nfacet normal 0 0 1\nvertex NaN 0 0\nendfacet".to_vec()).is_err());
    }

    #[test]
    fn obj_concave_faces_negative_indices_and_relative_materials_are_preserved() {
        let name = "modelica://Example/Resources/body.obj";
        let bytes = b"mtllib colors.mtl\nv 0 0 0\nv 2 0 0\nv 2 2 0\nv 1 1 0\nv 0 2 0\nusemtl orange\nf -5/1 -4/2 -3/3 -2/4 -1/5\n".to_vec();
        let material = "modelica://Example/Resources/colors.mtl";
        assert_eq!(dependencies(name,&bytes).unwrap(),[material]);
        let resources = HashMap::from([(name.into(),bytes),(material.into(),b"newmtl orange\nKd 1 0.5 0\n".to_vec())]);
        let mesh = parse(name,&resources).unwrap(); assert_eq!(mesh.triangles.len(),3);
        assert!(mesh.colors.iter().all(|color| *color == Some([255.0,127.5,0.0])));
        let area: f32 = mesh.vertices.chunks_exact(3).map(|p| ((p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0])).abs()/2.0).sum();
        assert_eq!(area,3.0);
        assert!(parse_one("broken.obj",b"v 0 0 0\nf 1 2 3\n".to_vec()).is_err());
        assert!(parse_one("part.obj",b"mtllib missing.mtl\nv 0 0 0\n".to_vec()).is_err());
    }

    #[test]
    fn three_ds_materials_and_faces_survive_binary_chunks_and_truncation_is_an_error() {
        fn chunk(id: u16, data: Vec<u8>) -> Vec<u8> { [id.to_le_bytes().to_vec(),((data.len()+6) as u32).to_le_bytes().to_vec(),data].concat() }
        let mut vertices = 3u16.to_le_bytes().to_vec();
        for value in [0.0_f32,0.0,0.0,1.0,0.0,0.0,0.0,2.0,0.0] { vertices.extend(value.to_le_bytes()); }
        let group = chunk(0x4130,[b"paint\0".to_vec(),1u16.to_le_bytes().to_vec(),0u16.to_le_bytes().to_vec()].concat());
        let mut faces = Vec::new(); for value in [1u16,0,1,2,0] { faces.extend(value.to_le_bytes()); } faces.extend(group);
        let object = chunk(0x4000,[b"part\0".to_vec(),chunk(0x4100,[chunk(0x4110,vertices),chunk(0x4120,faces)].concat())].concat());
        let material = chunk(0xafff,[chunk(0xa000,b"paint\0".to_vec()),chunk(0xa020,chunk(0x0011,vec![11,22,33]))].concat());
        let mut bytes = chunk(0x4d4d,chunk(0x3d3d,[object,material].concat()));
        let mesh = parse_one("part.3ds",bytes.clone()).unwrap(); assert_eq!(mesh.colors,[Some([11.0,22.0,33.0])]);
        assert_eq!(mesh.vertices,[[0.0,0.0,0.0],[1.0,0.0,0.0],[0.0,2.0,0.0]]);
        bytes.pop(); assert!(parse_one("part.3ds",bytes).is_err());
    }
}
