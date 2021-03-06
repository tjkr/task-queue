import {DOM} from 'aurelia-pal';

let hasSetImmediate = typeof setImmediate === 'function';

function makeRequestFlushFromMutationObserver(flush) {
  let toggle = 1;
  let observer = DOM.createMutationObserver(flush);
  let node = DOM.createTextNode('');
  observer.observe(node, {characterData: true});
  return function requestFlush() {
    toggle = -toggle;
    node.data = toggle;
  };
}

function makeRequestFlushFromTimer(flush) {
  return function requestFlush() {
    // We dispatch a timeout with a specified delay of 0 for engines that
    // can reliably accommodate that request. This will usually be snapped
    // to a 4 milisecond delay, but once we're flushing, there's no delay
    // between events.
    let timeoutHandle = setTimeout(handleFlushTimer, 0);
    // However, since this timer gets frequently dropped in Firefox
    // workers, we enlist an interval handle that will try to fire
    // an event 20 times per second until it succeeds.
    let intervalHandle = setInterval(handleFlushTimer, 50);
    function handleFlushTimer() {
      // Whichever timer succeeds will cancel both timers and request the
      // flush.
      clearTimeout(timeoutHandle);
      clearInterval(intervalHandle);
      flush();
    }
  };
}

function onError(error, task) {
  if ('onError' in task) {
    task.onError(error);
  } else if (hasSetImmediate) {
    setImmediate(() => { throw error; });
  } else {
    setTimeout(() => { throw error; }, 0);
  }
}

interface Callable {
  call(): void;
}

export class TaskQueue {
  constructor() {
    this.microTaskQueue = [];
    this.microTaskQueueCapacity = 1024;
    this.taskQueue = [];

    this.requestFlushMicroTaskQueue = makeRequestFlushFromMutationObserver(() => this.flushMicroTaskQueue());
    this.requestFlushTaskQueue = makeRequestFlushFromTimer(() => this.flushTaskQueue());
  }

  queueMicroTask(task: Callable | Function): void {
    if (this.microTaskQueue.length < 1) {
      this.requestFlushMicroTaskQueue();
    }

    this.microTaskQueue.push(task);
  }

  queueTask(task: Callable | Function): void {
    if (this.taskQueue.length < 1) {
      this.requestFlushTaskQueue();
    }

    this.taskQueue.push(task);
  }

  flushTaskQueue(): void {
    let queue = this.taskQueue;
    let index = 0;
    let task;

    this.taskQueue = []; //recursive calls to queueTask should be scheduled after the next cycle

    try {
      while (index < queue.length) {
        task = queue[index];
        task.call();
        index++;
      }
    } catch (error) {
      onError(error, task);
    }
  }

  flushMicroTaskQueue(): void {
    let queue = this.microTaskQueue;
    let capacity = this.microTaskQueueCapacity;
    let index = 0;
    let task;

    try {
      while (index < queue.length) {
        task = queue[index];
        task.call();
        index++;

        // Prevent leaking memory for long chains of recursive calls to `queueMicroTask`.
        // If we call `queueMicroTask` within a MicroTask scheduled by `queueMicroTask`, the queue will
        // grow, but to avoid an O(n) walk for every MicroTask we execute, we don't
        // shift MicroTasks off the queue after they have been executed.
        // Instead, we periodically shift 1024 MicroTasks off the queue.
        if (index > capacity) {
            // Manually shift all values starting at the index back to the
            // beginning of the queue.
          for (let scan = 0; scan < index; scan++) {
            queue[scan] = queue[scan + index];
          }

          queue.length -= index;
          index = 0;
        }
      }
    } catch (error) {
      onError(error, task);
    }

    queue.length = 0;
  }
}
