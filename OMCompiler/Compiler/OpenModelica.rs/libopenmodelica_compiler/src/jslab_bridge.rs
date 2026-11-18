//! Stable WebAssembly ABI used by JSLAB Simulate.

use wasm_bindgen::prelude::*;

use crate::wasm_api;

const ABI_VERSION: u32 = 1;

#[wasm_bindgen]
pub fn jslab_bridge_version() -> u32 {
    ABI_VERSION
}

#[wasm_bindgen]
pub fn jslab_bridge_enable() -> u32 {
    wasm_api::omc_enable_cancel_poll();
    wasm_api::omc_enable_progress_sink();
    wasm_api::omc_enable_wasm_blobs();
    ABI_VERSION
}

#[wasm_bindgen]
pub fn jslab_set_env(name: &str, value: &str) {
    wasm_api::omc_set_env(name, value);
}

#[wasm_bindgen]
pub fn jslab_init() -> bool {
    wasm_api::omc_init()
}

#[wasm_bindgen]
pub fn jslab_eval(command: &str) -> String {
    wasm_api::omc_eval(command)
}

#[wasm_bindgen]
pub fn jslab_take_pending_downloads() -> JsValue {
    wasm_api::omc_take_pending_downloads()
}

#[wasm_bindgen]
pub fn jslab_vfs_load_zip(mount: &str, data: &[u8]) -> Result<usize, String> {
    wasm_api::omc_vfs_load_zip(mount, data)
}

#[wasm_bindgen]
pub fn jslab_write_file(path: &str, bytes: &[u8]) {
    wasm_api::wasi_write_file(path, bytes);
}

#[wasm_bindgen]
pub fn jslab_simulate(
    class_name: &str,
    stop_time: f64,
    number_of_intervals: i32,
    tolerance: f64,
    method: &str,
    simflags: &str,
) -> String {
    wasm_api::omc_simulate(class_name, stop_time, number_of_intervals, tolerance, method, simflags)
}

#[wasm_bindgen]
pub fn jslab_sim_series() -> JsValue {
    wasm_api::omc_sim_series()
}

#[wasm_bindgen]
pub fn jslab_sim_parameters() -> JsValue {
    wasm_api::omc_sim_parameters()
}

#[wasm_bindgen]
pub fn jslab_sim_units() -> JsValue {
    wasm_api::omc_sim_units()
}

#[wasm_bindgen]
pub fn jslab_sim_info() -> JsValue {
    wasm_api::omc_sim_info()
}

#[wasm_bindgen]
pub fn jslab_sim_time() -> Option<Vec<f64>> {
    wasm_api::omc_sim_time()
}

#[wasm_bindgen]
pub fn jslab_sim_column(index: usize) -> Option<Vec<f64>> {
    wasm_api::omc_sim_column(index)
}

#[wasm_bindgen]
pub fn jslab_set_inwasm_driver(mode: i32) {
    wasm_api::omc_set_inwasm_driver(mode);
}

#[wasm_bindgen]
pub fn jslab_set_sim_bench(enabled: bool) {
    wasm_api::omc_set_sim_bench(enabled);
}
