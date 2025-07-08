"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retryWithBackoff = void 0;
const debug = require("debug");
const log = debug('agenda:retry');
/**
 * Default retry condition for MongoDB write conflicts and duplicate key errors
 */
const defaultShouldRetry = (error) => {
    if (!error)
        return false;
    // MongoDB write conflict error codes
    return (error.code === 11000 || // Duplicate key error
        error.codeName === 'WriteConflict' ||
        error.code === 112 || // WriteConflict
        (error.message && error.message.includes('WriteConflict')) ||
        (error.message && error.message.includes('duplicate key')));
};
/**
 * Executes an async operation with exponential backoff retry logic
 *
 * @param operation - The async operation to execute
 * @param options - Retry configuration options
 * @returns Promise that resolves with the operation result
 * @throws The last error if all retries are exhausted
 */
async function retryWithBackoff(operation, options = {}) {
    const { maxRetries = 3, baseDelay = 100, maxDelay = 5000, shouldRetry = defaultShouldRetry } = options;
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            const result = await operation();
            // Log successful retry if this wasn't the first attempt
            if (attempt > 0) {
                log('Operation succeeded on attempt %d/%d', attempt + 1, maxRetries + 1);
            }
            return result;
        }
        catch (error) {
            lastError = error;
            // If this is the last attempt or error shouldn't be retried, throw immediately
            if (attempt === maxRetries || !shouldRetry(error)) {
                if (attempt === maxRetries) {
                    log('All retry attempts exhausted (%d/%d). Final error: %O', attempt + 1, maxRetries + 1, (error === null || error === void 0 ? void 0 : error.message) || error);
                }
                else {
                    log('Error not retryable: %O', (error === null || error === void 0 ? void 0 : error.message) || error);
                }
                throw error;
            }
            // Calculate delay with exponential backoff and jitter
            const exponentialDelay = baseDelay * 2 ** attempt;
            const jitter = Math.random() * baseDelay; // Add randomness to prevent thundering herd
            const delay = Math.min(exponentialDelay + jitter, maxDelay);
            log('Retry attempt %d/%d after %dms delay. Error: %O', attempt + 1, maxRetries, Math.round(delay), (error === null || error === void 0 ? void 0 : error.message) || error);
            // Wait before retrying
            await new Promise(resolve => {
                setTimeout(resolve, delay);
            });
        }
    }
    // This should never be reached, but included for type safety
    throw lastError;
}
exports.retryWithBackoff = retryWithBackoff;
//# sourceMappingURL=retryWithBackoff.js.map