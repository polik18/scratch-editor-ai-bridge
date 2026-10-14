/**
 * The message loop inside a sandboxed iframe. Never runs in the parent page.
 *
 * Messages from the parent carry `__sandbox_payload`, or `__sandbox_warm` for a
 * setup-only round trip, plus a `__sandbox_ticket`. The first message to a
 * frame also carries `__sandbox_init`. Replies carry `__sandbox_result` or
 * `__sandbox_error` and the same ticket. To handle several items in one round
 * trip, send an array as the payload.
 *
 * Scripts loaded with this one must define `window.onSandboxMessage`, and may
 * define `window.onSandboxInit`. Nothing here runs `eval`: code reaches the
 * frame only as `<script>` tags, and messages carry data only.
 *
 * Untranspiled, so capped at ES2017.
 */
(function () {
    const post = (ticket, key, value) => {
        const message = {__sandbox_ticket: ticket};
        message[key] = value;
        // The frame has an opaque origin, so there is no origin to name.
        // The parent filters on event.source.
        parent.postMessage(message, '*');
    };

    // Init data comes with the first message to each frame only, so a failed
    // init is kept and reported on every later message. Otherwise the frame
    // would keep answering with the data missing.
    let initError = null;
    const opaqueParentMeta = document.querySelector(
        'meta[name="scratch-svg-renderer-opaque-parent"]'
    );
    const allowOpaqueParentSource =
        opaqueParentMeta && opaqueParentMeta.content === 'true';

    window.addEventListener('message', event => {
        // Keep the source guard except inside the isolated Scratch AI Bridge
        // preview, where nested opaque-origin WindowProxy identity can fail.
        if (!allowOpaqueParentSource && event.source !== parent) return;

        const data = event.data;
        const ticket = data && data.__sandbox_ticket;

        try {
            if (initError) throw initError;
            if (typeof data.__sandbox_init !== 'undefined') {
                try {
                    if (typeof window.onSandboxInit !== 'function') {
                        throw new Error(
                            'Sandbox: init data was provided but no frame script ' +
                                'defined window.onSandboxInit'
                        );
                    }
                    window.onSandboxInit(data.__sandbox_init);
                } catch (err) {
                    initError = err;
                    throw err;
                }
            }

            if (typeof window.onSandboxMessage !== 'function') {
                throw new Error(
                    'Sandbox: frame scripts did not define window.onSandboxMessage'
                );
            }

            // Warm-up pays the frame's setup cost early. The result is
            // undefined; the parent resolves on the absence of an error.
            if (data.__sandbox_warm) {
                post(ticket, '__sandbox_result');
                return;
            }

            Promise.resolve(window.onSandboxMessage(data.__sandbox_payload))
                .then(result => post(ticket, '__sandbox_result', result))
                .catch(err =>
                    post(
                        ticket,
                        '__sandbox_error',
                        (err && err.message) || String(err)
                    )
                );
        } catch (err) {
            post(
                ticket,
                '__sandbox_error',
                (err && err.message) || String(err)
            );
        }
    });
}());
