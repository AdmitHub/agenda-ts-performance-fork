import * as debug from 'debug';

const log = debug('agenda:retry');

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
 * Default retry condition for MongoDB write conflicts and duplicate key errors
 */
const defaultShouldRetry = (error: any): boolean => {
	if (!error) return false;

	// MongoDB write conflict error codes
	return (
		error.code === 11000 || // Duplicate key error
		error.codeName === 'WriteConflict' ||
		error.code === 112 || // WriteConflict
		(error.message && error.message.includes('WriteConflict')) ||
		(error.message && error.message.includes('duplicate key'))
	);
};

/**
 * Executes an async operation with exponential backoff retry logic
 *
 * @param operation - The async operation to execute
 * @param options - Retry configuration options
 * @returns Promise that resolves with the operation result
 * @throws The last error if all retries are exhausted
 */
export async function retryWithBackoff<T>(
	operation: () => Promise<T>,
	options: IRetryOptions = {}
): Promise<T> {
	const {
		maxRetries = 3,
		baseDelay = 100,
		maxDelay = 5000,
		shouldRetry = defaultShouldRetry
	} = options;

	let lastError: any;

	for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
		try {
			const result = await operation();

			// Log successful retry if this wasn't the first attempt
			if (attempt > 0) {
				log('Operation succeeded on attempt %d/%d', attempt + 1, maxRetries + 1);
			}

			return result;
		} catch (error) {
			lastError = error;

			// If this is the last attempt or error shouldn't be retried, throw immediately
			if (attempt === maxRetries || !shouldRetry(error)) {
				if (attempt === maxRetries) {
					log(
						'All retry attempts exhausted (%d/%d). Final error: %O',
						attempt + 1,
						maxRetries + 1,
						(error as any)?.message || error
					);
				} else {
					log('Error not retryable: %O', (error as any)?.message || error);
				}
				throw error;
			}

			// Calculate delay with exponential backoff and jitter
			const exponentialDelay = baseDelay * 2 ** attempt;
			const jitter = Math.random() * baseDelay; // Add randomness to prevent thundering herd
			const delay = Math.min(exponentialDelay + jitter, maxDelay);

			log(
				'Retry attempt %d/%d after %dms delay. Error: %O',
				attempt + 1,
				maxRetries,
				Math.round(delay),
				(error as any)?.message || error
			);

			// Wait before retrying
			await new Promise<void>(resolve => {
				setTimeout(resolve, delay);
			});
		}
	}

	// This should never be reached, but included for type safety
	throw lastError;
}
