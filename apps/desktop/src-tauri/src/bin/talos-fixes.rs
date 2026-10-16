//! Prints FIX_CATALOG as JSON for the TypeScript contract test and the docs.

fn main() {
    println!("{}", talos_desktop_lib::fix::catalog::dump_json());
}
