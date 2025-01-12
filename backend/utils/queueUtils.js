class BusQueue {
  constructor() {
    this.queue = [];
  }

  enqueue(item) {
    this.queue.push(item);
  }

  dequeue() {
    return this.queue.shift();
  }

  getQueue() {
    return this.queue;
  }
}

module.exports = { BusQueue };
