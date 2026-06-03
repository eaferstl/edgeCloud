;; Sieve of Eratosthenes in raw WebAssembly: computes all primes below 1000
;; and prints them comma-separated to stdout via WASI fd_write.
;; Memory layout: 0 iovec, 16 itoa scratch, 1024 sieve bytes, 4096 output buffer.
(module
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 1)
  (global $N i32 (i32.const 1000))
  (func (export "_start")
    (local $i i32) (local $j i32) (local $out i32)
    (local $n i32) (local $d i32) (local $len i32)

    ;; mark 2..N-1 as candidate primes
    (local.set $i (i32.const 2))
    (block $init_done (loop $init
      (br_if $init_done (i32.ge_u (local.get $i) (global.get $N)))
      (i32.store8 (i32.add (i32.const 1024) (local.get $i)) (i32.const 1))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $init)))

    ;; sieve: for i where i*i < N, clear multiples
    (local.set $i (i32.const 2))
    (block $sieve_done (loop $sieve
      (br_if $sieve_done (i32.ge_u (i32.mul (local.get $i) (local.get $i)) (global.get $N)))
      (if (i32.load8_u (i32.add (i32.const 1024) (local.get $i)))
        (then
          (local.set $j (i32.mul (local.get $i) (local.get $i)))
          (block $clear_done (loop $clear
            (br_if $clear_done (i32.ge_u (local.get $j) (global.get $N)))
            (i32.store8 (i32.add (i32.const 1024) (local.get $j)) (i32.const 0))
            (local.set $j (i32.add (local.get $j) (local.get $i)))
            (br $clear)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $sieve)))

    ;; emit "p, p, p, ...\n"
    (local.set $out (i32.const 4096))
    (local.set $i (i32.const 2))
    (block $emit_done (loop $emit
      (br_if $emit_done (i32.ge_u (local.get $i) (global.get $N)))
      (if (i32.load8_u (i32.add (i32.const 1024) (local.get $i)))
        (then
          ;; itoa: digits of $i, reversed, into scratch@16
          (local.set $n (local.get $i))
          (local.set $len (i32.const 0))
          (block $itoa_done (loop $itoa
            (local.set $d (i32.rem_u (local.get $n) (i32.const 10)))
            (i32.store8 (i32.add (i32.const 16) (local.get $len))
                        (i32.add (local.get $d) (i32.const 48)))
            (local.set $len (i32.add (local.get $len) (i32.const 1)))
            (local.set $n (i32.div_u (local.get $n) (i32.const 10)))
            (br_if $itoa_done (i32.eqz (local.get $n)))
            (br $itoa)))
          ;; copy scratch reversed into out
          (block $copy_done (loop $copy
            (br_if $copy_done (i32.eqz (local.get $len)))
            (local.set $len (i32.sub (local.get $len) (i32.const 1)))
            (i32.store8 (local.get $out)
                        (i32.load8_u (i32.add (i32.const 16) (local.get $len))))
            (local.set $out (i32.add (local.get $out) (i32.const 1)))
            (br $copy)))
          ;; ", "
          (i32.store8 (local.get $out) (i32.const 44))
          (i32.store8 (i32.add (local.get $out) (i32.const 1)) (i32.const 32))
          (local.set $out (i32.add (local.get $out) (i32.const 2)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $emit)))

    ;; turn the trailing ", " into "\n"
    (local.set $out (i32.sub (local.get $out) (i32.const 1)))
    (i32.store8 (i32.sub (local.get $out) (i32.const 1)) (i32.const 10))

    ;; iovec { buf = 4096, len = out - 4096 }, nwritten -> 8
    (i32.store (i32.const 0) (i32.const 4096))
    (i32.store (i32.const 4) (i32.sub (local.get $out) (i32.const 4096)))
    (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8)))
  )
)
