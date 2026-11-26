use super::*;

fn parse(line: &str) -> Option<SshTarget> {
    let args: Vec<String> = line.split(' ').map(str::to_string).collect();
    parse_ssh_args(&args)
}

fn target(user: Option<&str>, host: &str, port: Option<&str>) -> Option<SshTarget> {
    Some(SshTarget {
        user: user.map(str::to_string),
        host: host.to_string(),
        port: port.map(str::to_string),
    })
}

#[test]
fn reads_user_at_host() {
    assert_eq!(
        parse("ssh root@10.0.0.5"),
        target(Some("root"), "10.0.0.5", None)
    );
    assert_eq!(parse("ssh.exe build-box"), target(None, "build-box", None));
}

#[test]
fn reads_port_and_login_options_attached_or_separate() {
    assert_eq!(
        parse("ssh -p 2222 me@host"),
        target(Some("me"), "host", Some("2222"))
    );
    assert_eq!(
        parse("ssh -p2222 -lroot host"),
        target(Some("root"), "host", Some("2222"))
    );
    assert_eq!(
        parse("ssh -l admin -p 22 host"),
        target(Some("admin"), "host", Some("22"))
    );
}

#[test]
fn skips_flags_and_the_values_of_other_options() {
    assert_eq!(
        parse("ssh -vvv -A -i C:/keys/id_ed25519 -L 8080:localhost:80 -J jump me@host"),
        target(Some("me"), "host", None),
    );
    assert_eq!(
        parse("ssh -At -p 2200 host"),
        target(None, "host", Some("2200"))
    );
}

#[test]
fn reads_port_and_user_from_o_settings() {
    assert_eq!(
        parse("ssh -o Port=2022 -o User=ops host"),
        target(Some("ops"), "host", Some("2022"))
    );
    assert_eq!(
        parse("ssh -oStrictHostKeyChecking=no host"),
        target(None, "host", None)
    );
}

#[test]
fn reads_ssh_uris_with_ports_and_ipv6_hosts() {
    assert_eq!(
        parse("ssh ssh://me@host:2222"),
        target(Some("me"), "host", Some("2222"))
    );
    assert_eq!(
        parse("ssh ssh://[fe80::1]:22"),
        target(None, "fe80::1", Some("22"))
    );
}

#[test]
fn ignores_the_remote_command_after_the_destination() {
    assert_eq!(parse("ssh host uptime -p"), target(None, "host", None));
}

#[test]
fn has_no_target_without_a_destination() {
    assert_eq!(parse("ssh -V"), None);
    assert_eq!(parse("ssh"), None);
    assert_eq!(parse("ssh -p"), None);
}

#[test]
fn takes_an_argument_after_double_dash_as_the_destination() {
    assert_eq!(parse("ssh -p 22 -- host"), target(None, "host", Some("22")));
}

#[test]
fn ignores_an_invalid_port_or_user() {
    assert_eq!(parse("ssh -p 99999 host"), target(None, "host", None));
    assert_eq!(parse("ssh -p abc host"), target(None, "host", None));
}
