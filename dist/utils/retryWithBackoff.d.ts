export interface IRetryOptions {
    /**
     * Maximum number of retry attempts (default: 3)
     */
    maxRetries?: number;
    /**
     * Base delay in milliseconds between retries (default: 100)
     */
    baseDelay?: number;
    /**
     * Maximum delay in milliseconds to prevent excessive waits (default: 5000)
     */
    maxDelay?: number;
    /**
     * Function to determine if an error should trigger a retry
     * Defaults to checking for MongoDB write conflicts and duplicate key errors
     */
    shouldRetry?: (error: any) => boolean;
}
/**
 * Executes an async operation with exponential backoff retry logic
 *
 * @param operation - The async operation to execute
 * @param options - Retry configuration options
 * @returns Promise that resolves with the operation result
 * @throws The last error if all retries are exhausted
 */
export declare function retryWithBackoff<T>(operation: () => Promise<T>, options?: IRetryOptions): Promise<T>;
