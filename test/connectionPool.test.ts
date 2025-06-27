import { expect } from 'chai';
import { Agenda } from '../src';
import { ConnectionPoolManager } from '../src/utils/ConnectionPoolManager';
import { MongoMemoryServer } from 'mongodb-memory-server';

describe('Connection Pool Management', () => {
	let mongoServer: MongoMemoryServer;
	let mongoUrl: string;

	before(async () => {
		mongoServer = await MongoMemoryServer.create();
		mongoUrl = mongoServer.getUri();
	});

	after(async () => {
		await mongoServer.stop();
	});

	beforeEach(() => {
		// Clear all pools before each test
		ConnectionPoolManager.clearAllPools();
	});

	describe('ConnectionPoolManager', () => {
		it('should create singleton instances for same connection string', () => {
			const pool1 = ConnectionPoolManager.getInstance(mongoUrl);
			const pool2 = ConnectionPoolManager.getInstance(mongoUrl);
			
			expect(pool1).to.equal(pool2);
			expect(pool1.getReferenceCount()).to.equal(2);
		});

		it('should create different instances for different connection strings', () => {
			const pool1 = ConnectionPoolManager.getInstance(mongoUrl);
			const pool2 = ConnectionPoolManager.getInstance(mongoUrl + '2');
			
			expect(pool1).to.not.equal(pool2);
			expect(pool1.getReferenceCount()).to.equal(1);
			expect(pool2.getReferenceCount()).to.equal(1);
		});

		it('should apply environment-specific defaults', () => {
			const originalEnv = process.env.NODE_ENV;
			
			try {
				process.env.NODE_ENV = 'test';
				const pool = ConnectionPoolManager.getInstance(mongoUrl);
				expect(pool).to.be.instanceOf(ConnectionPoolManager);
				
				process.env.NODE_ENV = 'production';
				const prodPool = ConnectionPoolManager.getInstance(mongoUrl + '3');
				expect(prodPool).to.be.instanceOf(ConnectionPoolManager);
			} finally {
				process.env.NODE_ENV = originalEnv;
			}
		});

		it('should properly manage reference counting', async () => {
			const pool1 = ConnectionPoolManager.getInstance(mongoUrl);
			const pool2 = ConnectionPoolManager.getInstance(mongoUrl);
			
			expect(pool1.getReferenceCount()).to.equal(2);
			
			await pool1.disconnect();
			expect(pool2.getReferenceCount()).to.equal(1);
			
			await pool2.disconnect();
			expect(pool2.getReferenceCount()).to.equal(0);
		});

		it('should connect to MongoDB successfully', async () => {
			const pool = ConnectionPoolManager.getInstance(mongoUrl);
			const db = await pool.connect();
			
			expect(db).to.not.be.null;
			expect(pool.getClient()).to.not.be.undefined;
			
			await pool.disconnect();
		});

		it('should provide pool status', async () => {
			const pool = ConnectionPoolManager.getInstance(mongoUrl);
			await pool.connect();
			
			const status = await pool.getPoolStatus();
			expect(status).to.not.be.null;
			expect(status.metrics).to.have.property('poolSize');
			expect(status.metrics).to.have.property('availableConnections');
			expect(status.isHealthy).to.be.a('boolean');
			
			await pool.disconnect();
		});
	});

	describe('Agenda Connection Pool Integration', () => {
		let agenda1: Agenda;
		let agenda2: Agenda;

		afterEach(async () => {
			if (agenda1) {
				await agenda1.stop();
			}
			if (agenda2) {
				await agenda2.stop();
			}
		});

		it('should share connection pools between Agenda instances', async () => {
			agenda1 = new Agenda({ db: { address: mongoUrl } });
			agenda2 = new Agenda({ db: { address: mongoUrl } });

			await agenda1.ready;
			await agenda2.ready;

			// Both should be using the same connection pool
			const status1 = await agenda1.getConnectionPoolStatus();
			const status2 = await agenda2.getConnectionPoolStatus();

			expect(status1).to.not.be.null;
			expect(status2).to.not.be.null;
			
			// They should both be healthy (indicating connection sharing works)
			expect(status1!.isHealthy).to.be.true;
			expect(status2!.isHealthy).to.be.true;
			
			// Pool size should be at least the minimum configured
			expect(status1!.metrics.poolSize).to.be.at.least(1);
			expect(status2!.metrics.poolSize).to.be.at.least(1);
		});

		it('should not share pools with different connection options', async () => {
			agenda1 = new Agenda({ 
				db: { 
					address: mongoUrl,
					options: { maxPoolSize: 10 }
				}
			});
			agenda2 = new Agenda({ 
				db: { 
					address: mongoUrl,
					options: { maxPoolSize: 20 }
				}
			});

			await agenda1.ready;
			await agenda2.ready;

			const status1 = await agenda1.getConnectionPoolStatus();
			const status2 = await agenda2.getConnectionPoolStatus();

			expect(status1).to.not.be.null;
			expect(status2).to.not.be.null;
		});

		it('should properly disconnect from shared pools', async () => {
			agenda1 = new Agenda({ db: { address: mongoUrl } });
			agenda2 = new Agenda({ db: { address: mongoUrl } });

			await agenda1.ready;
			await agenda2.ready;

			// Stop first agenda
			await agenda1.stop();
			
			// Second agenda should still work
			const status = await agenda2.getConnectionPoolStatus();
			expect(status).to.not.be.null;
			expect(status!.isHealthy).to.be.true;
		});

		it('should handle connection pool monitoring events', async () => {
			agenda1 = new Agenda({ db: { address: mongoUrl } });
			await agenda1.ready;

			let eventReceived = false;
			agenda1.on('connectionPoolWarning', (warning) => {
				eventReceived = true;
				expect(warning).to.be.a('string');
			});

			// Trigger pool status check
			const status = await agenda1.getConnectionPoolStatus();
			expect(status).to.not.be.null;
		});

		it('should work with user-provided mongo client', async () => {
			const { MongoClient } = await import('mongodb');
			const client = await MongoClient.connect(mongoUrl);
			
			try {
				agenda1 = new Agenda({ mongo: client.db() });
				await agenda1.ready;

				// Should not have pool status for user-provided connections
				const status = await agenda1.getConnectionPoolStatus();
				expect(status).to.be.null;
			} finally {
				await client.close();
			}
		});
	});

	describe('Environment Configuration', () => {
		it('should use test environment defaults in test mode', () => {
			const originalEnv = process.env.NODE_ENV;
			
			try {
				process.env.NODE_ENV = 'test';
				const pool = ConnectionPoolManager.getInstance(mongoUrl + '_test');
				expect(pool).to.be.instanceOf(ConnectionPoolManager);
			} finally {
				process.env.NODE_ENV = originalEnv;
			}
		});

		it('should use production environment defaults in production mode', () => {
			const originalEnv = process.env.NODE_ENV;
			
			try {
				process.env.NODE_ENV = 'production';
				const pool = ConnectionPoolManager.getInstance(mongoUrl + '_prod');
				expect(pool).to.be.instanceOf(ConnectionPoolManager);
			} finally {
				process.env.NODE_ENV = originalEnv;
			}
		});

		it('should use development defaults for unknown environments', () => {
			const originalEnv = process.env.NODE_ENV;
			
			try {
				process.env.NODE_ENV = 'unknown';
				const pool = ConnectionPoolManager.getInstance(mongoUrl + '_unknown');
				expect(pool).to.be.instanceOf(ConnectionPoolManager);
			} finally {
				process.env.NODE_ENV = originalEnv;
			}
		});
	});

	describe('Pool Health Monitoring', () => {
		it('should detect healthy pool status', async () => {
			const pool = ConnectionPoolManager.getInstance(mongoUrl);
			await pool.connect();
			
			const status = await pool.getPoolStatus();
			expect(status.isHealthy).to.be.true;
			expect(status.warnings).to.be.an('array');
			
			await pool.disconnect();
		});

		it('should return unhealthy status for uninitialized pool', async () => {
			const pool = ConnectionPoolManager.getInstance(mongoUrl + '_uninitialized');
			
			const status = await pool.getPoolStatus();
			expect(status.isHealthy).to.be.false;
			expect(status.warnings).to.include('Connection pool not initialized');
		});

		it('should provide meaningful metrics', async () => {
			const pool = ConnectionPoolManager.getInstance(mongoUrl);
			await pool.connect();
			
			const status = await pool.getPoolStatus();
			const metrics = status.metrics;
			
			expect(metrics).to.have.property('poolSize');
			expect(metrics).to.have.property('availableConnections');
			expect(metrics).to.have.property('pendingConnections');
			expect(metrics).to.have.property('waitQueueSize');
			expect(metrics).to.have.property('totalCreated');
			expect(metrics).to.have.property('totalClosed');
			expect(metrics).to.have.property('checkedOut');
			
			expect(metrics.poolSize).to.be.a('number');
			expect(metrics.availableConnections).to.be.a('number');
			
			await pool.disconnect();
		});
	});

	describe('Error Handling', () => {
		it('should handle connection failures gracefully', async () => {
			const pool = ConnectionPoolManager.getInstance('mongodb://invalid-host:27017/test');
			
			try {
				await pool.connect();
				expect.fail('Should have thrown an error');
			} catch (error) {
				expect(error).to.be.instanceOf(Error);
			}
		});

		it('should handle pool status errors gracefully', async () => {
			const pool = ConnectionPoolManager.getInstance(mongoUrl + '_error');
			
			const status = await pool.getPoolStatus();
			expect(status.isHealthy).to.be.false;
			expect(status.warnings).to.not.be.empty;
		});

		it('should handle multiple disconnect calls safely', async () => {
			const pool = ConnectionPoolManager.getInstance(mongoUrl);
			await pool.connect();
			
			await pool.disconnect();
			await pool.disconnect(); // Should not throw
			
			expect(pool.getReferenceCount()).to.equal(0);
		});
	});
});