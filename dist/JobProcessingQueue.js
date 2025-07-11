"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobProcessingQueue = void 0;
/**
 * @class
 */
class JobProcessingQueue {
    constructor(agenda, maxQueueSize = 500000) {
        this.agenda = agenda;
        this._queue = [];
        this.maxQueueSize = maxQueueSize;
    }
    get length() {
        return this._queue.length;
    }
    getQueue() {
        return this._queue;
    }
    /**
     * Pops and returns last queue element (next job to be processed) without checking concurrency.
     * @returns {Job} Next Job to be processed
     */
    pop() {
        return this._queue.pop();
    }
    /**
     * Inserts job in first queue position
     * @param {Job} job job to add to queue
     * @returns {undefined}
     */
    /*
    push(job: Job): void {
        this._queue.push(job);
    } */
    remove(job) {
        let removeJobIndex = this._queue.indexOf(job);
        if (removeJobIndex === -1) {
            // lookup by id
            removeJobIndex = this._queue.findIndex(j => { var _a, _b; return ((_a = j.attrs._id) === null || _a === void 0 ? void 0 : _a.toString()) === ((_b = job.attrs._id) === null || _b === void 0 ? void 0 : _b.toString()); });
        }
        if (removeJobIndex === -1) {
            throw new Error(`cannot find job ${job.attrs._id} in processing queue?`);
        }
        this._queue.splice(removeJobIndex, 1);
    }
    /**
     * Inserts job in queue where it will be order from left to right in decreasing
     * order of nextRunAt and priority (in case of same nextRunAt), if all values
     * are even the first jobs to be introduced will have priority
     * @param {Job} job job to add to queue
     * @returns {boolean} true if job was inserted, false if queue is full
     */
    insert(job) {
        // Check if queue is at capacity
        if (this._queue.length >= this.maxQueueSize) {
            // Queue is full - implement overflow handling
            // Could emit an event here for monitoring
            this.agenda.emit('queueOverflow', {
                jobName: job.attrs.name,
                queueSize: this._queue.length,
                maxSize: this.maxQueueSize
            });
            return false;
        }
        const matchIndex = this._queue.findIndex(element => {
            if (element.attrs.nextRunAt &&
                job.attrs.nextRunAt &&
                element.attrs.nextRunAt.getTime() <= job.attrs.nextRunAt.getTime()) {
                if (element.attrs.nextRunAt.getTime() === job.attrs.nextRunAt.getTime()) {
                    if (element.attrs.priority >= job.attrs.priority) {
                        return true;
                    }
                }
                else {
                    return true;
                }
            }
            return false;
        });
        if (matchIndex === -1) {
            // put on left side of the queue
            this._queue.unshift(job);
        }
        else {
            this._queue.splice(matchIndex, 0, job);
        }
        return true;
    }
    /**
     * Gets the current queue utilization as a percentage
     * @returns {number} utilization percentage (0-100)
     */
    getUtilization() {
        return (this._queue.length / this.maxQueueSize) * 100;
    }
    /**
     * Checks if the queue is approaching capacity
     * @param {number} threshold threshold percentage (default 80%)
     * @returns {boolean} true if queue is approaching capacity
     */
    isNearCapacity(threshold = 80) {
        return this.getUtilization() >= threshold;
    }
    /**
     * Returns (does not pop, element remains in queue) first element (always from the right)
     * that can be processed (not blocked by concurrency execution)
     * @param {Object} jobStatus current status of jobs
     * @returns {Job} Next Job to be processed
     */
    returnNextConcurrencyFreeJob(jobStatus, handledJobs) {
        const next = Object.keys(this._queue).reverse().find(i => {
            const def = this.agenda.definitions[this._queue[i].attrs.name];
            const status = jobStatus[this._queue[i].attrs.name];
            // check if we have a definition
            // if there is no status available, we are good to go
            // if there is no max concurrency defined (0), we are also good to go
            // and if concurrency limit is not reached yet (actual running jobs is lower than max concurrency)
            if (def &&
                !handledJobs.includes(this._queue[i].attrs._id) &&
                (!status || !def.concurrency || status.running < def.concurrency)) {
                return true;
            }
            return false;
        });
        return next !== undefined
            ? this._queue[next]
            : undefined;
    }
}
exports.JobProcessingQueue = JobProcessingQueue;
//# sourceMappingURL=JobProcessingQueue.js.map