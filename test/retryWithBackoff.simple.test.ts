import { expect } from 'chai';
import { retryWithBackoff, IRetryOptions } from '../src/utils/retryWithBackoff';

describe('retryWithBackoff - Core Functionality', () => {
	describe('successful operations', () => {
		it('should succeed on first attempt', async () => {
			let attempts = 0;
			const operation = async () => {
				attempts++;
				return 'success';
			};

			const result = await retryWithBackoff(operation);

			expect(result).to.equal('success');
			expect(attempts).to.equal(1);
		});

		it('should return the correct result type', async () => {
			const operation = async () => ({ id: 123, name: 'test' });

			const result = await retryWithBackoff(operation);

			expect(result).to.deep.equal({ id: 123, name: 'test' });
		});
	});

	describe('retry on write conflicts', () => {
		it('should retry on MongoDB write conflict (code 112)', async () => {
			let attempts = 0;
			const operation = async () => {
				attempts++;
				if (attempts < 3) {
					const error: any = new Error('Write conflict');
					error.code = 112;
					throw error;
				}
				return 'success after retries';
			};

			const result = await retryWithBackoff(operation, {
				baseDelay: 1, // Very short delay for testing
				maxDelay: 10
			});

			expect(result).to.equal('success after retries');
			expect(attempts).to.equal(3);
		});

		it('should retry on MongoDB duplicate key error (code 11000)', async () => {
			let attempts = 0;
			const operation = async () => {
				attempts++;
				if (attempts < 2) {
					const error: any = new Error('Duplicate key');
					error.code = 11000;
					throw error;
				}
				return 'success';
			};

			const result = await retryWithBackoff(operation, {
				baseDelay: 1,
				maxDelay: 10
			});

			expect(result).to.equal('success');
			expect(attempts).to.equal(2);
		});

		it('should retry on WriteConflict by codeName', async () => {
			let attempts = 0;
			const operation = async () => {
				attempts++;
				if (attempts === 1) {
					const error: any = new Error('Write conflict');
					error.codeName = 'WriteConflict';
					throw error;
				}
				return 'success';
			};

			const result = await retryWithBackoff(operation, {
				baseDelay: 1,
				maxDelay: 10
			});

			expect(result).to.equal('success');
			expect(attempts).to.equal(2);
		});

		it('should retry on WriteConflict by message content', async () => {
			let attempts = 0;
			const operation = async () => {
				attempts++;
				if (attempts === 1) {
					throw new Error('Operation failed due to WriteConflict');
				}
				return 'success';
			};

			const result = await retryWithBackoff(operation, {
				baseDelay: 1,
				maxDelay: 10
			});

			expect(result).to.equal('success');
			expect(attempts).to.equal(2);
		});

		it('should retry on duplicate key by message content', async () => {
			let attempts = 0;
			const operation = async () => {
				attempts++;
				if (attempts === 1) {
					throw new Error('E11000 duplicate key error collection');
				}
				return 'success';
			};

			const result = await retryWithBackoff(operation, {
				baseDelay: 1,
				maxDelay: 10
			});

			expect(result).to.equal('success');
			expect(attempts).to.equal(2);
		});
	});

	describe('retry limits', () => {
		it('should respect maxRetries limit', async () => {
			let attempts = 0;
			const operation = async () => {
				attempts++;
				const error: any = new Error('Persistent write conflict');
				error.code = 112;
				throw error;
			};

			const options: IRetryOptions = {
				maxRetries: 2,
				baseDelay: 1,
				maxDelay: 10
			};

			try {
				await retryWithBackoff(operation, options);
				expect.fail('Should have thrown after max retries');
			} catch (error: any) {
				expect(error.message).to.equal('Persistent write conflict');
				expect(attempts).to.equal(3); // Initial attempt + 2 retries
			}
		});

		it('should use default retry options when none provided', async () => {
			let attempts = 0;
			const operation = async () => {
				attempts++;
				if (attempts < 4) {
					const error: any = new Error('Write conflict');
					error.code = 112;
					throw error;
				}
				return 'success';
			};

			const result = await retryWithBackoff(operation); // No options provided

			expect(result).to.equal('success');
			expect(attempts).to.equal(4); // Initial + 3 retries (default)
		});
	});

	describe('non-retryable errors', () => {
		it('should not retry application errors', async () => {
			let attempts = 0;
			const operation = async () => {
				attempts++;
				throw new Error('Application logic error');
			};

			try {
				await retryWithBackoff(operation);
				expect.fail('Should have thrown immediately');
			} catch (error: any) {
				expect(error.message).to.equal('Application logic error');
				expect(attempts).to.equal(1); // No retries
			}
		});

		it('should not retry validation errors', async () => {
			let attempts = 0;
			const operation = async () => {
				attempts++;
				const error: any = new Error('Validation failed');
				error.code = 'VALIDATION_ERROR';
				throw error;
			};

			try {
				await retryWithBackoff(operation);
				expect.fail('Should have thrown immediately');
			} catch (error: any) {
				expect(error.message).to.equal('Validation failed');
				expect(attempts).to.equal(1); // No retries
			}
		});

		it('should use custom shouldRetry function', async () => {
			let attempts = 0;
			const operation = async () => {
				attempts++;
				if (attempts === 1) {
					const error: any = new Error('Custom retryable error');
					error.customCode = 'RETRY_ME';
					throw error;
				}
				return 'success';
			};

			const customShouldRetry = (error: any) => {
				return error.customCode === 'RETRY_ME';
			};

			const result = await retryWithBackoff(operation, {
				shouldRetry: customShouldRetry,
				baseDelay: 1,
				maxDelay: 10
			});

			expect(result).to.equal('success');
			expect(attempts).to.equal(2);
		});
	});

	describe('edge cases', () => {
		it('should handle null/undefined errors', async () => {
			let attempts = 0;
			const operation = async () => {
				attempts++;
				throw null;
			};

			try {
				await retryWithBackoff(operation);
				expect.fail('Should have thrown immediately');
			} catch (error) {
				expect(error).to.be.null;
				expect(attempts).to.equal(1); // No retries for null error
			}
		});

		it('should handle errors without codes or messages', async () => {
			let attempts = 0;
			const operation = async () => {
				attempts++;
				throw {}; // Empty error object
			};

			try {
				await retryWithBackoff(operation);
				expect.fail('Should have thrown immediately');
			} catch (error) {
				expect(error).to.deep.equal({});
				expect(attempts).to.equal(1); // No retries
			}
		});

		it('should handle zero maxRetries', async () => {
			let attempts = 0;
			const operation = async () => {
				attempts++;
				const error: any = new Error('Write conflict');
				error.code = 112;
				throw error;
			};

			try {
				await retryWithBackoff(operation, { maxRetries: 0 });
				expect.fail('Should have thrown immediately');
			} catch (error: any) {
				expect(error.message).to.equal('Write conflict');
				expect(attempts).to.equal(1); // No retries
			}
		});
	});

	describe('exponential backoff behavior', () => {
		it('should implement exponential backoff', async () => {
			let attempts = 0;
			const startTime = Date.now();
			
			const operation = async () => {
				attempts++;
				if (attempts < 3) {
					const error: any = new Error('Write conflict');
					error.code = 112;
					throw error;
				}
				return 'success';
			};

			const result = await retryWithBackoff(operation, {
				maxRetries: 2,
				baseDelay: 50, // 50ms base delay
				maxDelay: 1000
			});

			const totalTime = Date.now() - startTime;

			expect(result).to.equal('success');
			expect(attempts).to.equal(3);
			// Should take at least the cumulative delay time (50ms + ~100ms + jitter)
			expect(totalTime).to.be.greaterThan(100);
		});

		it('should respect maxDelay limit', async () => {
			let attempts = 0;
			const operation = async () => {
				attempts++;
				if (attempts < 3) {
					const error: any = new Error('Write conflict');
					error.code = 112;
					throw error;
				}
				return 'success';
			};

			// Test with very low maxDelay to ensure it's respected
			const result = await retryWithBackoff(operation, {
				maxRetries: 2,
				baseDelay: 1000, // Large base delay
				maxDelay: 50 // But cap it at 50ms
			});

			expect(result).to.equal('success');
			expect(attempts).to.equal(3);
		});
	});
});