# Design: fix outgoing input event order

`WriteQueue.#run` is the single serialization seam. It invokes an optional
`onStart(item)` callback before calling the transport writer, then invokes the
existing result audit callback after the writer settles. Session implementations
use `onStart` to append the outgoing raw-bytes event and use the result audit only
for failures. This preserves queue ordering and makes synchronous transport
callbacks observe an already-recorded outgoing event.

The renderer remains unchanged: it still renders outgoing bytes locally and uses
the pending-echo matcher to suppress the subsequent device echo. No delay or
renderer-side event reordering is introduced.
