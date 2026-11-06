// Lookahead tick on a Worker: hidden tabs throttle main-thread timers, Workers much less (D4).
setInterval(() => postMessage(0), 25);
