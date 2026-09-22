# PDF excerpt work uses a shared dedicated queue

Accepted design; implementation is pending.

The shared Excerpt Image service owns a dedicated queue for PDF loading, parsing, and excerpt rendering. Literature Note creation and update batches and Imported Note batches submit cache misses to this queue and await their results. The queue's concurrency and resource limits are independent of note-operation concurrency, and all consumers share it rather than creating a queue per batch.

Bounded freshness and cache checks run before PDF queue admission. A valid cached image can complete while an unrelated PDF is rendering. Identical in-flight work remains deduplicated across callers. Durable asset materialization belongs to each destination note and runs outside the PDF queue.

Each note awaits its own excerpt outcomes and can advance independently of other notes in the batch. Note writes and excerpt asset writes have separate ownership and scheduling; the PDF queue does not perform either vault write. An image embed is finalized only after its asset is successfully saved, or after an existing asset is verified for retention. The batch UI remains active until all admitted PDF work, excerpt asset writes, and note writes settle.

The queue initially runs one PDF job at a time. It may reorder pending requests into groups of at most four excerpts that reuse the loaded PDF, then gives other waiting PDFs a turn. Batch import and PDF reader viewing are mutually exclusive workloads for this design, so interactive-versus-batch priority is unnecessary. Both workloads share cache entries across transitions. Owned resources are released at the end of their bounded lifetime. Increased PDF concurrency requires performance and memory measurements.

The queue admits at most 128 distinct jobs. Producers wait for capacity when the queue is full; capacity exhaustion alone does not make an image unavailable. Capacity waits support cancellation. Batch cancellation retains its existing contract: queued note operations stop while admitted note operations finish.

This preserves progressive note completion while controlling expensive PDF work across concurrent consumers. It avoids making cached images wait for PDF work and avoids multiplying PDF concurrency when another batch starts. Existing PDF size, canvas, execution-time, and teardown bounds remain in force. Queue and fairness limits are initial tuning values to verify with measurements.
