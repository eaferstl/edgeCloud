;; Minimal WASI module: prints a greeting to stdout via fd_write.
;; Compiled with `npm run build-wasm` (wabt) into src/modules/hello.wasm.
(module
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 1)
  ;; iovec at 0: { buf = 8, len = 44 }; nwritten written to 64
  (data (i32.const 8) "Hello from WebAssembly, via edgeCloud! \u{1f389}\n")
  (func (export "_start")
    (i32.store (i32.const 0) (i32.const 8))
    (i32.store (i32.const 4) (i32.const 44))
    (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 64)))
  )
)
