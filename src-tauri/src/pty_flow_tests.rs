use std::sync::Arc;
use std::time::Duration;

use super::{OutputCredit, OutputFlows, HIGH_WATER, LOW_WATER};

const WAIT: Duration = Duration::from_millis(50);

#[tokio::test]
async fn a_stream_keeps_reading_while_the_renderer_keeps_up() {
    let credit = OutputCredit::default();
    credit.sent(HIGH_WATER - 1);
    assert!(credit.room().await);
}

#[tokio::test]
async fn a_stream_waits_past_the_high_water_mark_until_the_renderer_catches_up() {
    let credit = Arc::new(OutputCredit::default());
    credit.sent(HIGH_WATER);
    let waiter = tokio::spawn({
        let credit = Arc::clone(&credit);
        async move { credit.room().await }
    });
    tokio::time::sleep(WAIT).await;
    assert!(!waiter.is_finished(), "the stream must stop reading");

    // Acknowledging less than enough to reach the low-water mark keeps it waiting.
    credit.ack(HIGH_WATER - LOW_WATER - 1);
    tokio::time::sleep(WAIT).await;
    assert!(!waiter.is_finished(), "resumes only at the low-water mark");

    credit.ack(1);
    let resumed = tokio::time::timeout(Duration::from_secs(5), waiter)
        .await
        .expect("the stream resumes after the renderer caught up")
        .expect("the waiting task does not panic");
    assert!(resumed);
}

#[tokio::test]
async fn closing_the_credit_ends_a_waiting_stream() {
    let credit = Arc::new(OutputCredit::default());
    credit.sent(HIGH_WATER);
    let waiter = tokio::spawn({
        let credit = Arc::clone(&credit);
        async move { credit.room().await }
    });
    tokio::time::sleep(WAIT).await;
    credit.close();
    let resumed = tokio::time::timeout(Duration::from_secs(5), waiter)
        .await
        .expect("a closed credit wakes the stream")
        .expect("the waiting task does not panic");
    assert!(!resumed);
}

#[test]
fn an_acknowledgement_larger_than_what_was_sent_does_not_wrap() {
    let credit = OutputCredit::default();
    credit.sent(10);
    credit.ack(1_000);
    assert_eq!(credit.unacked(), 0);
}

#[tokio::test]
async fn a_new_stream_for_the_same_session_closes_the_one_it_replaces() {
    let flows = OutputFlows::default();
    let old = flows.open("pane");
    let new = flows.open("pane");
    assert!(!old.room().await, "the replaced stream stops");
    assert!(new.room().await);

    // The old stream ending must not drop the new stream's credit.
    flows.release("pane", &old);
    new.sent(100);
    flows.ack("pane", 40);
    assert_eq!(new.unacked(), 60);

    flows.release("pane", &new);
    flows.ack("pane", 60);
    assert_eq!(
        new.unacked(),
        60,
        "a released credit no longer takes acknowledgements"
    );
}

#[tokio::test]
async fn disconnecting_a_session_ends_its_stream() {
    let flows = OutputFlows::default();
    let credit = flows.open("pane");
    flows.close("pane");
    assert!(!credit.room().await);
}
