use super::*;

const DIGITS: &[Tok] = &[Tok::Cap(0, &[Tok::Class(is_digit, 1, 2)])];
const CLOCKISH: &[Tok] = &[
    Tok::Cap(0, &[Tok::Class(is_digit, 1, 2)]),
    Tok::Class(is_space, 0, MANY),
    Tok::Cap(
        1,
        &[Tok::Opt(&[Tok::Alt(&[
            &[Tok::Lit("am")],
            &[Tok::Lit("pm")],
        ])])],
    ),
    Tok::Ahead(&[Tok::Alt(&[&[Tok::End], &[Tok::Class(is_space, 1, 1)]])]),
];

#[test]
fn finds_the_leftmost_match_with_captures() {
    let subject = chars("ab 12 cd");
    let found = find(DIGITS, &subject).expect("digits");
    assert_eq!((found.start, found.end), (3, 5));
    assert_eq!(found.group(&subject, 0).as_deref(), Some("12"));
}

#[test]
fn backtracks_greedy_runs_and_optional_groups_like_a_regex() {
    // `\s*` gives its space back so the look-ahead can see it; the meridiem group then fails.
    let subject = chars("3 pmx");
    let found = find(CLOCKISH, &subject).expect("clock");
    assert_eq!(found.group(&subject, 0).as_deref(), Some("3"));
    assert_eq!(found.caps[1].map(|(a, b)| b - a), Some(0));
    let subject = chars("3 PM");
    let found = find(CLOCKISH, &subject).expect("clock");
    assert_eq!(found.group(&subject, 1).as_deref(), Some("PM"));
}

#[test]
fn honours_anchors_boundaries_and_repetition() {
    const WORD: &[Tok] = &[Tok::Start, Tok::Boundary, Tok::Lit("in"), Tok::Boundary];
    assert!(test(WORD, "in 2h"));
    assert!(!test(WORD, "inside"));
    assert!(!test(WORD, " in"));
    const UNITS: &[Tok] = &[
        Tok::Plus(&[Tok::Class(is_digit, 1, MANY), Tok::Class(is_alpha, 1, 1)]),
        Tok::End,
    ];
    assert!(test(UNITS, "1d2h3m"));
    assert!(!test(UNITS, "1d2"));
    assert_eq!(string(&chars("xy")), "xy");
}
