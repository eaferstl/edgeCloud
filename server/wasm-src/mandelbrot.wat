;; ASCII Mandelbrot renderer in raw WebAssembly.
;; Memory layout: 0 iovec, 8 nwritten, 128 charset, 4096 output buffer.
(module
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 1)
  (data (i32.const 128) " .:-=+*#%@")

  (global $WIDTH i32 (i32.const 100))
  (global $HEIGHT i32 (i32.const 40))
  (global $MAX_ITER i32 (i32.const 80))

  (func (export "_start")
    (local $x i32) (local $y i32) (local $iter i32)
    (local $idx i32) (local $out i32)
    (local $cr f64) (local $ci f64)
    (local $zr f64) (local $zi f64)
    (local $zr2 f64) (local $zi2 f64) (local $next_zr f64)

    (local.set $out (i32.const 4096))
    (local.set $y (i32.const 0))
    (block $rows_done (loop $rows
      (br_if $rows_done (i32.ge_u (local.get $y) (global.get $HEIGHT)))

      ;; ci = (y / 39) * 2.4 - 1.2
      (local.set $ci
        (f64.sub
          (f64.mul
            (f64.div
              (f64.convert_i32_s (local.get $y))
              (f64.const 39.0))
            (f64.const 2.4))
          (f64.const 1.2)))

      (local.set $x (i32.const 0))
      (block $cols_done (loop $cols
        (br_if $cols_done (i32.ge_u (local.get $x) (global.get $WIDTH)))

        ;; cr = (x / 99) * 3.0 - 2.0
        (local.set $cr
          (f64.sub
            (f64.mul
              (f64.div
                (f64.convert_i32_s (local.get $x))
                (f64.const 99.0))
              (f64.const 3.0))
            (f64.const 2.0)))

        (local.set $zr (f64.const 0.0))
        (local.set $zi (f64.const 0.0))
        (local.set $iter (i32.const 0))

        (block $escape_done (loop $escape
          (br_if $escape_done (i32.ge_u (local.get $iter) (global.get $MAX_ITER)))

          (local.set $zr2 (f64.mul (local.get $zr) (local.get $zr)))
          (local.set $zi2 (f64.mul (local.get $zi) (local.get $zi)))
          (br_if $escape_done
            (f64.gt
              (f64.add (local.get $zr2) (local.get $zi2))
              (f64.const 4.0)))

          (local.set $next_zr
            (f64.add
              (f64.sub (local.get $zr2) (local.get $zi2))
              (local.get $cr)))
          (local.set $zi
            (f64.add
              (f64.mul
                (f64.mul (local.get $zr) (local.get $zi))
                (f64.const 2.0))
              (local.get $ci)))
          (local.set $zr (local.get $next_zr))
          (local.set $iter (i32.add (local.get $iter) (i32.const 1)))
          (br $escape)))

        ;; Map 0..MAX_ITER to the 10-byte charset at memory offset 128.
        (local.set $idx
          (i32.div_u
            (i32.mul (local.get $iter) (i32.const 9))
            (global.get $MAX_ITER)))
        (i32.store8
          (local.get $out)
          (i32.load8_u (i32.add (i32.const 128) (local.get $idx))))
        (local.set $out (i32.add (local.get $out) (i32.const 1)))

        (local.set $x (i32.add (local.get $x) (i32.const 1)))
        (br $cols)))

      (i32.store8 (local.get $out) (i32.const 10))
      (local.set $out (i32.add (local.get $out) (i32.const 1)))
      (local.set $y (i32.add (local.get $y) (i32.const 1)))
      (br $rows)))

    ;; iovec { buf = 4096, len = out - 4096 }, nwritten -> 8
    (i32.store (i32.const 0) (i32.const 4096))
    (i32.store (i32.const 4) (i32.sub (local.get $out) (i32.const 4096)))
    (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8)))
  )
)
