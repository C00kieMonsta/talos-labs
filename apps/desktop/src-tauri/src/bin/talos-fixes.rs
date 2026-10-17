//! Prints FIX_CATALOG as JSON for the TypeScript contract test and the docs; `--watch` prints
//! the watch catalogue and the playbook instead.

fn main() {
    if std::env::args().any(|a| a == "--watch") {
        println!(
            "{{\"watchCatalog\":{},\"playbook\":{}}}",
            talos_desktop_lib::fix::catalog::dump_watch_json(),
            talos_desktop_lib::watch::playbook::dump_json()
        );
    } else {
        println!("{}", talos_desktop_lib::fix::catalog::dump_json());
    }
}
