//! Strict result-backed scenes and batched geometry for JSLAB figures.
//!
//! Shape placement uses the shared animation core. No dimensions, frame names,
//! colors or connections are inferred from a particular mechanism model.

use std::collections::HashMap;
use crate::{Attr, Resolver, Scene, ShapeInstance, ShapeKind};

#[derive(Clone, Default)]
pub struct Mesh {
    pub vertices: Vec<[f32; 3]>,
    pub triangles: Vec<[u32; 3]>,
    /// CAD face colors; absent entries retain the model's material color.
    pub colors: Vec<Option<[f32; 3]>>,
}

impl Mesh {
    fn vertex(&mut self, p: [f32; 3]) -> u32 {
        let index = self.vertices.len() as u32;
        self.vertices.push(p);
        index
    }

    fn quad(&mut self, p: [[f32; 3]; 4]) {
        let i = p.map(|point| self.vertex(point));
        self.triangles.extend([[i[0], i[1], i[2]], [i[0], i[2], i[3]]]);
    }
}

pub struct Batch {
    pub mesh: Mesh,
    pub color: [f32; 3],
    pub specular: f32,
}

struct Row<'a> {
    columns: &'a HashMap<String, Vec<f64>>,
    index: usize,
}

impl Resolver for Row<'_> {
    fn value(&self, name: &str, _: f64) -> f64 {
        // Constructor validation guarantees every referenced column and row.
        let values = &self.columns[name];
        values[if values.len() == 1 { 0 } else { self.index }]
    }
}

pub struct JslabScene {
    pub scene: Scene,
    time: Vec<f64>,
    columns: HashMap<String, Vec<f64>>,
    groups: Vec<Vec<usize>>,
    geometry: Vec<Option<Mesh>>,
    cad: HashMap<usize, Mesh>,
    rigid: bool,
}

impl JslabScene {
    pub fn new(xml: &str, time: Vec<f64>, columns: HashMap<String, Vec<f64>>) -> Result<Self, String> {
        Self::with_resources(xml, time, columns, &HashMap::new())
    }

    pub fn resources(xml: &str) -> Result<Vec<String>, String> {
        let scene = Scene::parse(xml)?;
        let mut names = Vec::new();
        for shape in scene.shapes {
            if shape.kind == ShapeKind::Cad && !names.contains(&shape.type_text) { names.push(shape.type_text); }
        }
        Ok(names)
    }

    pub fn with_resources(xml: &str, time: Vec<f64>, columns: HashMap<String, Vec<f64>>,
        resources: &crate::cad::Resources) -> Result<Self, String> {
        let document = roxmltree::Document::parse(xml).map_err(|error| error.to_string())?;
        if !document.root_element().has_tag_name("visualization") {
            return Err("The solver did not return a visualization scene.".into());
        }
        // The upstream convenience parser supplies defaults for absent fields.
        // A compiler-produced scene must instead contain complete finite data.
        for node in document.root_element().children().filter(|node| node.is_element()) {
            if !node.has_tag_name("shape") {
                return Err(format!("Unsupported scene element: {}", node.tag_name().name()));
            }
            for (name, count) in [("T", 9), ("r", 3), ("r_shape", 3), ("lengthDir", 3),
                ("widthDir", 3), ("length", 1), ("width", 1), ("height", 1), ("extra", 1),
                ("color", 3), ("specCoeff", 1)] {
                let field = node.children().find(|child| child.has_tag_name(name))
                    .ok_or_else(|| format!("The scene shape is missing {name}."))?;
                let values: Vec<_> = field.children().filter(|child| child.is_element()).collect();
                if values.len() != count {
                    return Err(format!("Invalid scene field {name}: expected {count} values."));
                }
                for value in values {
                    let text = value.text().unwrap_or("").trim();
                    match value.tag_name().name() {
                        "cref" if !text.is_empty() => {},
                        "exp" | "enum" if text.parse::<f64>().is_ok_and(f64::is_finite) => {},
                        "bconst" if text == "true" || text == "false" => {},
                        _ => return Err(format!("Invalid scene value in {name}: {text}")),
                    }
                }
            }
        }
        if time.is_empty() || time.iter().any(|value| !value.is_finite()) ||
            time.windows(2).any(|pair| pair[1] < pair[0]) {
            return Err("Animation requires finite, ordered simulation times.".into());
        }
        let scene = Scene::parse(xml)?;
        for name in scene.crefs() {
            let values = columns.get(&name).ok_or_else(|| format!("Missing scene result: {name}"))?;
            if (values.len() != 1 && values.len() != time.len()) || values.iter().any(|value| !value.is_finite()) {
                return Err(format!("Incomplete or non-finite scene result: {name}"));
            }
        }
        let mut groups: Vec<Vec<usize>> = Vec::new();
        let mut keys: HashMap<String, usize> = HashMap::new();
        for (index, shape) in scene.shapes.iter().enumerate() {
            let material_key = |attribute: &Attr| match attribute {
                Attr::Const(value) => format!("C{}", (*value as f32).to_bits()),
                Attr::Cref(name) => {
                    let values = &columns[name];
                    if values.iter().all(|value| *value as f32 == values[0] as f32) {
                        format!("C{}", (values[0] as f32).to_bits())
                    } else { format!("R{name}") }
                }
            };
            let key = shape.color.iter().chain(std::iter::once(&shape.spec_coeff))
                .map(material_key).collect::<Vec<_>>().join("|");
            let group = *keys.entry(key).or_insert_with(|| { groups.push(Vec::new()); groups.len() - 1 });
            groups[group].push(index);
        }
        let first = Row { columns: &columns, index: 0 };
        let mut geometry = Vec::new();
        let mut cad = HashMap::new();
        for (index, shape) in scene.shapes.iter().enumerate() {
            if shape.kind == ShapeKind::Cad { cad.insert(index, crate::cad::parse(&shape.type_text, resources)?); }
            let fixed = [&shape.length, &shape.width, &shape.height, &shape.extra].iter().all(|value| match value {
                Attr::Const(_) => true,
                Attr::Cref(name) => columns[name].iter().all(|value| *value as f32 == columns[name][0] as f32),
            });
            geometry.push(if fixed { Some(shape_mesh(&shape.instance(&first, time[0]), cad.get(&index))?) } else { None });
        }
        let rigid = geometry.iter().all(Option::is_some) && scene.shapes.iter().all(|shape|
            shape.color.iter().chain(std::iter::once(&shape.spec_coeff)).all(|value| match value {
                Attr::Const(_) => true,
                Attr::Cref(name) => columns[name].iter().all(|value| *value as f32 == columns[name][0] as f32),
            }));
        Ok(Self { scene, time, columns, groups, geometry, cad, rigid })
    }

    pub fn len(&self) -> usize { self.time.len() }
    pub fn is_empty(&self) -> bool { self.time.is_empty() }
    pub fn fixed_topology(&self) -> bool { self.geometry.iter().all(Option::is_some) }

    /// Rigid playback can retain both vertex buffers and materials for the whole run.
    pub fn rigid(&self) -> bool {
        self.rigid
    }

    fn rigid_parts(&self) -> Vec<usize> {
        self.geometry.iter().enumerate().filter_map(|(index, mesh)|
            mesh.as_ref().filter(|mesh| !mesh.vertices.is_empty()).map(|_| index)).collect()
    }

    /// Individual world meshes are generated at startup or for an explicit export.
    pub fn part_frame(&self, index: usize) -> Result<Vec<Batch>, String> {
        if !self.rigid() { return Err("The scene requires deforming geometry or changing materials.".into()); }
        self.frame_groups(index, &self.rigid_parts().into_iter().map(|index| vec![index]).collect::<Vec<_>>())
    }

    /// Column-major GPU matrices move the initial meshes without rebuilding vertices.
    pub fn rigid_transforms(&self, index: usize) -> Result<Vec<[f32; 16]>, String> {
        if !self.rigid() || index >= self.len() { return Err("Invalid rigid animation frame.".into()); }
        let first = Row { columns: &self.columns, index: 0 };
        let row = Row { columns: &self.columns, index };
        Ok(self.rigid_parts().iter().map(|&part| {
            let initial = self.scene.shapes[part].instance(&first, self.time[0]);
            let current = self.scene.shapes[part].instance(&row, self.time[index]);
            let mut matrix = [0.0; 16];
            for column in 0..3 {
                for axis in 0..3 {
                    matrix[column * 4 + axis] = (0..3).map(|k|
                        current.rot[k * 3 + axis] * initial.rot[k * 3 + column]).sum();
                }
            }
            for axis in 0..3 {
                matrix[12 + axis] = current.pos[axis] - (0..3).map(|k|
                    matrix[k * 4 + axis] * initial.pos[k]).sum::<f32>();
            }
            matrix[15] = 1.0;
            matrix
        }).collect())
    }

    pub fn frame(&self, index: usize) -> Result<Vec<Batch>, String> {
        self.frame_groups(index, &self.groups)
    }

    fn frame_groups(&self, index: usize, groups: &[Vec<usize>]) -> Result<Vec<Batch>, String> {
        if index >= self.time.len() { return Err("The animation frame is out of range.".into()); }
        let row = Row { columns: &self.columns, index };
        let t = self.time[index];
        let mut batches = Vec::with_capacity(groups.len());
        for group in groups {
            let first = &self.scene.shapes[group[0]];
            let mut batch = Batch { mesh: Mesh::default(),
                color: first.color.each_ref().map(|value| value.resolve(&row, t) as f32),
                specular: first.spec_coeff.resolve(&row, t) as f32 };
            for &shape_index in group {
                let shape = &self.scene.shapes[shape_index];
                let instance = shape.instance(&row, t);
                let generated;
                let local = if let Some(mesh) = &self.geometry[shape_index] { mesh }
                    else { generated = shape_mesh(&instance, self.cad.get(&shape_index))?; &generated };
                let offset = batch.mesh.vertices.len() as u32;
                batch.mesh.vertices.extend(local.vertices.iter().map(|point| place(point, &instance)));
                if !local.colors.is_empty() && batch.mesh.colors.is_empty() {
                    batch.mesh.colors.resize(batch.mesh.triangles.len(), None);
                }
                if !batch.mesh.colors.is_empty() || !local.colors.is_empty() {
                    batch.mesh.colors.extend((0..local.triangles.len()).map(|i| local.colors.get(i).copied().flatten()));
                }
                batch.mesh.triangles.extend(local.triangles.iter().map(|face| face.map(|i| i + offset)));
            }
            batches.push(batch);
        }
        Ok(batches)
    }

    pub fn bounds(&self) -> Result<[[f32; 2]; 3], String> {
        let mut bounds = [[f32::INFINITY, f32::NEG_INFINITY]; 3];
        let local_bounds = self.geometry.iter().map(|mesh| mesh.as_ref().map(mesh_bounds)).collect::<Vec<_>>();
        for index in 0..self.len() {
            let row = Row { columns: &self.columns, index };
            for (shape_index, shape) in self.scene.shapes.iter().enumerate() {
                if self.geometry[shape_index].as_ref().is_some_and(|mesh| mesh.vertices.is_empty()) { continue; }
                let instance = shape.instance(&row, self.time[index]);
                let local = match local_bounds[shape_index] {
                    Some(value) => value,
                    None => {
                        let mesh = shape_mesh(&instance, self.cad.get(&shape_index))?;
                        if mesh.vertices.is_empty() { continue; }
                        mesh_bounds(&mesh)
                    },
                };
                if local.iter().flatten().any(|value| !value.is_finite()) {
                    return Err("The scene contains non-finite geometry.".into());
                }
                for corner in 0..8 {
                    let point = place(&std::array::from_fn(|axis| local[axis][(corner >> axis) & 1]), &instance);
                    if point.iter().any(|value| !value.is_finite()) {
                        return Err("The scene contains non-finite geometry.".into());
                    }
                    for axis in 0..3 {
                        bounds[axis][0] = bounds[axis][0].min(point[axis]);
                        bounds[axis][1] = bounds[axis][1].max(point[axis]);
                    }
                }
            }
        }
        if bounds.iter().flatten().any(|value| !value.is_finite()) {
            return Err("The scene contains no finite geometry.".into());
        }
        Ok(bounds)
    }
}

fn shape_mesh(instance: &ShapeInstance, cad: Option<&Mesh>) -> Result<Mesh, String> {
    if let Some(cad) = cad {
        let mut mesh = cad.clone();
        if instance.extra != 0.0 { for point in &mut mesh.vertices {
            for axis in 0..3 { point[axis] *= instance.size[axis]; }
        } }
        Ok(mesh)
    } else { primitive(instance) }
}

fn mesh_bounds(mesh: &Mesh) -> [[f32; 2]; 3] {
    let mut bounds = [[f32::INFINITY, f32::NEG_INFINITY]; 3];
    for point in &mesh.vertices {
        for axis in 0..3 {
            bounds[axis][0] = bounds[axis][0].min(point[axis]);
            bounds[axis][1] = bounds[axis][1].max(point[axis]);
        }
    }
    bounds
}

fn place(point: &[f32; 3], shape: &ShapeInstance) -> [f32; 3] {
    std::array::from_fn(|axis| shape.pos[axis] +
        point[0] * shape.rot[axis] + point[1] * shape.rot[3 + axis] + point[2] * shape.rot[6 + axis])
}

fn primitive(shape: &ShapeInstance) -> Result<Mesh, String> {
    let [length, width, height] = shape.size;
    let mut mesh = Mesh::default();
    if shape.kind == 1 && length == 0.0 { return Ok(mesh); }
    match shape.kind {
        0 | 6 => {
            let (x, y) = (width / 2.0, height / 2.0);
            mesh.quad([[-x,-y,0.0],[-x,y,0.0],[x,y,0.0],[x,-y,0.0]]);
            mesh.quad([[-x,-y,length],[x,-y,length],[x,y,length],[-x,y,length]]);
            mesh.quad([[-x,-y,0.0],[x,-y,0.0],[x,-y,length],[-x,-y,length]]);
            mesh.quad([[x,-y,0.0],[x,y,0.0],[x,y,length],[x,-y,length]]);
            mesh.quad([[x,y,0.0],[-x,y,0.0],[-x,y,length],[x,y,length]]);
            mesh.quad([[-x,y,0.0],[-x,-y,0.0],[-x,-y,length],[-x,y,length]]);
        },
        1 => {
            let radius = length / 2.0;
            for latitude in 0..=12 {
                let phi = std::f32::consts::PI * latitude as f32 / 12.0;
                for longitude in 0..=24 {
                    let theta = std::f32::consts::TAU * longitude as f32 / 24.0;
                    mesh.vertex([radius * phi.sin() * theta.cos(), radius * phi.sin() * theta.sin(),
                        radius * (1.0 + phi.cos())]);
                }
            }
            for latitude in 0..12 {
                for longitude in 0..24 {
                    let a = latitude * 25 + longitude;
                    mesh.triangles.extend([[a,a+25,a+1],[a+1,a+25,a+26]]);
                }
            }
        },
        2 | 3 | 4 | 5 => {
            let radius = width / 2.0;
            let top = if shape.kind == 3 { radius * shape.extra } else { radius };
            let inner = if shape.kind == 4 || shape.kind == 5 { radius * shape.extra } else { 0.0 };
            if inner < 0.0 || inner > radius || top < 0.0 {
                return Err("Invalid cone or pipe dimensions in the scene.".into());
            }
            ring_wall(&mut mesh, radius, top, length, false);
            if inner > 0.0 { ring_wall(&mut mesh, inner, inner, length, true); }
            ring_cap(&mut mesh, inner, radius, 0.0, true);
            ring_cap(&mut mesh, inner, top, length, false);
        },
        7 => {
            let teeth = shape.extra.abs() as usize;
            if teeth == 0 { return Err("A gearwheel requires at least one tooth.".into()); }
            let count = teeth.checked_mul(4).ok_or("The gearwheel mesh is too large.")?;
            let mut outer = Vec::new();
            let mut inner = Vec::new();
            let radius = width / 2.0;
            for index in 0..count {
                let angle = std::f32::consts::TAU * index as f32 / count as f32;
                let tooth = if index % 4 == 1 || index % 4 == 2 { 1.0 } else { 0.85 };
                let (outside, inside) = if shape.extra > 0.0 { (radius * tooth, 0.0) }
                    else { (radius, radius * tooth * 0.85) };
                outer.push([outside * angle.cos(), outside * angle.sin()]);
                inner.push([inside * angle.cos(), inside * angle.sin()]);
            }
            for index in 0..count {
                let next = (index + 1) % count;
                let o = outer[index]; let on = outer[next];
                let i = inner[index]; let inn = inner[next];
                mesh.quad([[o[0],o[1],0.0],[on[0],on[1],0.0],[on[0],on[1],length],[o[0],o[1],length]]);
                mesh.quad([[i[0],i[1],0.0],[i[0],i[1],length],[inn[0],inn[1],length],[inn[0],inn[1],0.0]]);
                mesh.quad([[i[0],i[1],0.0],[inn[0],inn[1],0.0],[on[0],on[1],0.0],[o[0],o[1],0.0]]);
                mesh.quad([[i[0],i[1],length],[o[0],o[1],length],[on[0],on[1],length],[inn[0],inn[1],length]]);
            }
        },
        8 => {
            // Match the pinned native Spring sweep: ten elements per winding,
            // six around the wire, and a ring normal to each helix tangent.
            let segments = (shape.extra * 10.0) as usize + 1;
            if segments < 2 { return Ok(mesh); }
            let mut centers = Vec::new();
            for index in 0..segments {
                let angle = std::f32::consts::TAU * index as f32 / 10.0;
                centers.push([width * angle.sin(), width * angle.cos(), length * index as f32 / segments as f32]);
            }
            for index in 0..segments - 1 {
                let tangent = normalize(std::array::from_fn(|axis| centers[index + 1][axis] - centers[index][axis]));
                let axis = if tangent[0].abs() <= tangent[1].abs() && tangent[0].abs() <= tangent[2].abs() { [1.0,0.0,0.0] }
                    else if tangent[1].abs() <= tangent[2].abs() { [0.0,1.0,0.0] } else { [0.0,0.0,1.0] };
                let u = normalize(cross(tangent, axis));
                let v = normalize(cross(tangent, u));
                for contour in 0..6 {
                    let angle = std::f32::consts::TAU * contour as f32 / 6.0;
                    mesh.vertex(std::array::from_fn(|axis| centers[index][axis] +
                        height * (u[axis] * angle.cos() + v[axis] * angle.sin())));
                }
            }
            for index in 0..segments - 2 {
                for contour in 0..6 {
                    let a = (index * 6 + contour) as u32;
                    let b = (index * 6 + (contour + 1) % 6) as u32;
                    mesh.triangles.extend([[a,b,b+6],[a,b+6,a+6]]);
                }
            }
        },
        _ => return Err(format!("Unsupported scene primitive kind: {}", shape.kind)),
    }
    Ok(mesh)
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
}

fn normalize(value: [f32; 3]) -> [f32; 3] {
    let length = value.iter().map(|x| x*x).sum::<f32>().sqrt();
    if length == 0.0 { [0.0; 3] } else { value.map(|x| x/length) }
}

fn ring_wall(mesh: &mut Mesh, bottom: f32, top: f32, length: f32, reverse: bool) {
    let offset = mesh.vertices.len() as u32;
    for index in 0..=24 {
        let angle = std::f32::consts::TAU * index as f32 / 24.0;
        for (radius, z) in [(bottom, 0.0), (top, length)] {
            mesh.vertex([radius * angle.cos(), radius * angle.sin(), z]);
        }
    }
    for index in 0..24 {
        let a = offset + index * 2;
        let faces = [[a,a+2,a+1],[a+1,a+2,a+3]];
        mesh.triangles.extend(faces.map(|face| if reverse { [face[2],face[1],face[0]] } else { face }));
    }
}

fn ring_cap(mesh: &mut Mesh, inner: f32, outer: f32, z: f32, reverse: bool) {
    let offset = mesh.vertices.len() as u32;
    for index in 0..=24 {
        let angle = std::f32::consts::TAU * index as f32 / 24.0;
        for radius in [inner, outer] { mesh.vertex([radius * angle.cos(), radius * angle.sin(), z]); }
    }
    for index in 0..24 {
        let a = offset + index * 2;
        let faces = [[a,a+1,a+3],[a,a+3,a+2]];
        mesh.triangles.extend(faces.map(|face| if reverse { [face[2],face[1],face[0]] } else { face }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn xml(kind: &str, length: &str) -> String {
        format!(r#"<visualization><shape><ident>arbitrary.component</ident><type>{kind}</type>
        <T><exp>1</exp><exp>0</exp><exp>0</exp><exp>0</exp><exp>1</exp><exp>0</exp><exp>0</exp><exp>0</exp><exp>1</exp></T>
        <r><cref>position</cref><exp>2</exp><exp>3</exp></r><r_shape><exp>0</exp><exp>0</exp><exp>0</exp></r_shape>
        <lengthDir><exp>1</exp><exp>0</exp><exp>0</exp></lengthDir><widthDir><exp>0</exp><exp>1</exp><exp>0</exp></widthDir>
        <length>{length}</length><width><exp>2</exp></width><height><exp>4</exp></height><extra><exp>0</exp></extra>
        <color><exp>11</exp><exp>22</exp><exp>33</exp></color><specCoeff><exp>0.25</exp></specCoeff></shape></visualization>"#)
    }

    #[test]
    fn model_dimensions_colors_and_placement_are_preserved() {
        let scene = JslabScene::new(&xml("box", "<exp>6</exp>"), vec![0.0, 1.0],
            HashMap::from([("position".into(), vec![10.0, 20.0])])).unwrap();
        let frame = scene.frame(0).unwrap();
        assert_eq!(frame[0].color, [11.0, 22.0, 33.0]);
        assert_eq!(frame[0].specular, 0.25);
        assert!(scene.fixed_topology());
        assert_eq!(mesh_bounds(&frame[0].mesh), [[10.0,16.0],[1.0,3.0],[1.0,5.0]]);
        assert_eq!(scene.bounds().unwrap(), [[10.0,26.0],[1.0,3.0],[1.0,5.0]]);
        assert!(scene.frame(2).is_err());
    }

    #[test]
    fn dynamic_dimensions_use_each_actual_result_row() {
        let scene = JslabScene::new(&xml("box", "<cref>length</cref>"), vec![0.0, 1.0],
            HashMap::from([("position".into(), vec![0.0]), ("length".into(), vec![2.0, 6.0])])).unwrap();
        assert!(scene.geometry[0].is_none());
        assert!(!scene.fixed_topology());
        assert!(!scene.rigid());
        assert_eq!(mesh_bounds(&scene.frame(0).unwrap()[0].mesh)[0], [0.0,2.0]);
        assert_eq!(mesh_bounds(&scene.frame(1).unwrap()[0].mesh)[0], [0.0,6.0]);
    }

    #[test]
    fn rigid_gpu_matrices_match_world_meshes_for_rotation_and_translation() {
        let source = xml("box", "<exp>6</exp>").replace(
            "<T><exp>1</exp><exp>0</exp><exp>0</exp><exp>0</exp><exp>1</exp><exp>0</exp><exp>0</exp><exp>0</exp><exp>1</exp></T>",
            "<T><cref>c</cref><cref>s</cref><exp>0</exp><cref>ns</cref><cref>c</cref><exp>0</exp><exp>0</exp><exp>0</exp><exp>1</exp></T>");
        let scene = JslabScene::new(&source, vec![0.0, 1.0], HashMap::from([
            ("position".into(), vec![10.0, 20.0]), ("c".into(), vec![0.6, -0.8]),
            ("s".into(), vec![0.8, 0.6]), ("ns".into(), vec![-0.8, -0.6])])).unwrap();
        assert!(scene.rigid());
        let initial = scene.part_frame(0).unwrap();
        let expected = scene.part_frame(1).unwrap();
        let matrices = scene.rigid_transforms(1).unwrap();
        assert_eq!(initial.len(), matrices.len());
        for ((initial, expected), matrix) in initial.iter().zip(&expected).zip(&matrices) {
            for (point, expected) in initial.mesh.vertices.iter().zip(&expected.mesh.vertices) {
                for axis in 0..3 {
                    let actual = matrix[12 + axis] + (0..3).map(|k| point[k] * matrix[k * 4 + axis]).sum::<f32>();
                    assert!((actual - expected[axis]).abs() < 2e-5);
                }
            }
        }
        assert!(scene.rigid_transforms(2).is_err());
        let colors = source.replace("<color><exp>11</exp>", "<color><cref>red</cref>");
        let mut columns = scene.columns.clone();
        columns.insert("red".into(), vec![11.0, 22.0]);
        let changing = JslabScene::new(&colors, vec![0.0, 1.0], columns).unwrap();
        assert!(!changing.rigid());
        assert!(changing.part_frame(0).is_err());
    }

    #[test]
    fn absent_results_and_malformed_fields_never_become_zero_geometry() {
        assert!(JslabScene::new(&xml("box", "<exp>6</exp>"), vec![0.0], HashMap::new()).is_err());
        let columns = HashMap::from([("position".into(), vec![0.0])]);
        assert!(JslabScene::new(&xml("box", "<exp>not_a_number</exp>"), vec![0.0], columns.clone()).is_err());
        assert!(JslabScene::new(&xml("unknown", "<exp>6</exp>"), vec![0.0], columns).is_err());
    }

    #[test]
    fn cad_resources_follow_native_axes_colors_scaling_and_whole_run_bounds() {
        let uri = "modelica://Example/Resources/mesh.obj";
        let source = xml(uri,"<cref>length</cref>").replace("<extra><exp>0</exp></extra>","<extra><exp>1</exp></extra>");
        let resources = HashMap::from([(uri.into(),b"mtllib paint.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl metal\nf 1 2 3\n".to_vec()),
            ("modelica://Example/Resources/paint.mtl".into(),b"newmtl metal\nKd 1 0 0\n".to_vec())]);
        let columns = HashMap::from([("position".into(),vec![10.0,20.0]),("length".into(),vec![2.0,6.0])]);
        assert_eq!(JslabScene::resources(&source).unwrap(),[uri]);
        let scene = JslabScene::with_resources(&source,vec![0.0,1.0],columns.clone(),&resources).unwrap();
        assert!(!scene.fixed_topology());
        assert_eq!(scene.frame(0).unwrap()[0].mesh.vertices,[[10.0,2.0,3.0],[12.0,2.0,3.0],[10.0,4.0,3.0]]);
        assert_eq!(scene.frame(1).unwrap()[0].mesh.vertices[1],[26.0,2.0,3.0]);
        assert_eq!(scene.frame(0).unwrap()[0].mesh.colors,[Some([255.0,0.0,0.0])]);
        assert_eq!(scene.bounds().unwrap(),[[10.0,26.0],[2.0,4.0],[3.0,3.0]]);
        let native_size = source.replace("<extra><exp>1</exp></extra>","<extra><exp>0</exp></extra>");
        assert_eq!(JslabScene::with_resources(&native_size,vec![0.0,1.0],columns,&resources).unwrap().frame(0).unwrap()[0].mesh.vertices[1],[11.0,2.0,3.0]);
        assert!(JslabScene::with_resources(&source,vec![0.0],HashMap::from([("position".into(),vec![0.0]),("length".into(),vec![1.0])]),&HashMap::new()).is_err());
    }
}
