import type { Job, JobWithId } from './Job';
import type { IJobParameters } from './types/JobParameters';
import type { Agenda } from './index';
/**
 * @class
 */
export declare class JobProcessingQueue {
    private agenda;
    private _queue;
    private readonly maxQueueSize;
    constructor(agenda: Agenda, maxQueueSize?: number);
    get length(): number;
    getQueue(): Job[];
    /**
     * Pops and returns last queue element (next job to be processed) without checking concurrency.
     * @returns {Job} Next Job to be processed
     */
    pop(): Job | undefined;
    /**
     * Inserts job in first queue position
     * @param {Job} job job to add to queue
     * @returns {undefined}
     */
    remove(job: Job): void;
    /**
     * Inserts job in queue where it will be order from left to right in decreasing
     * order of nextRunAt and priority (in case of same nextRunAt), if all values
     * are even the first jobs to be introduced will have priority
     * @param {Job} job job to add to queue
     * @returns {boolean} true if job was inserted, false if queue is full
     */
    insert(job: Job): boolean;
    /**
     * Gets the current queue utilization as a percentage
     * @returns {number} utilization percentage (0-100)
     */
    getUtilization(): number;
    /**
     * Checks if the queue is approaching capacity
     * @param {number} threshold threshold percentage (default 80%)
     * @returns {boolean} true if queue is approaching capacity
     */
    isNearCapacity(threshold?: number): boolean;
    /**
     * Returns (does not pop, element remains in queue) first element (always from the right)
     * that can be processed (not blocked by concurrency execution)
     * @param {Object} jobStatus current status of jobs
     * @returns {Job} Next Job to be processed
     */
    returnNextConcurrencyFreeJob(jobStatus: {
        [jobName: string]: {
            running: number;
        } | undefined;
    }, handledJobs: IJobParameters['_id'][]): (JobWithId & {
        attrs: IJobParameters & {
            nextRunAt?: Date | null;
        };
    }) | undefined;
}
