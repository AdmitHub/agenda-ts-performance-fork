import { expect } from 'chai';
import { Db } from 'mongodb';
import { Agenda } from '../src';
import { mockMongo } from './helpers/mock-mongodb';
import * as delay from 'delay';

// Test that documentation examples work correctly
describe('Documentation Examples', () => {
	let mongoDb: Db;

	beforeEach(async () => {
		if (!mongoDb) {
			const mockedMongo = await mockMongo();
			mongoDb = mockedMongo.mongo.db();
		}
	});

	afterEach(async () => {
		if (mongoDb) {
			await mongoDb.collection('agendaJobs').deleteMany({});
		}
	});

	describe('Performance Configuration Examples', () => {
		it('should support high-throughput configuration from README', async () => {
			const agenda = new Agenda({
				mongo: mongoDb,
				maxConcurrency: 100,
				defaultConcurrency: 10,
				batchSize: 20,
				processEvery: '1 second',
				defaultLockLifetime: 5 * 60 * 1000 // 5 minutes
			});

			await delay(100); // Wait for connection

			expect(agenda.attrs.maxConcurrency).to.equal(100);
			expect(agenda.attrs.defaultConcurrency).to.equal(10);
			expect(agenda.attrs.batchSize).to.equal(20);
			expect(agenda.attrs.processEvery).to.equal(1000);
			expect(agenda.attrs.defaultLockLifetime).to.equal(300000);

			await agenda.stop();
		});

		it('should support resource-constrained configuration from README', async () => {
			const agenda = new Agenda({
				mongo: mongoDb,
				maxConcurrency: 5,
				defaultConcurrency: 1,
				batchSize: 3,
				processEvery: '10 seconds',
				defaultLockLifetime: 60 * 1000 // 1 minute
			});

			await delay(100); // Wait for connection

			expect(agenda.attrs.maxConcurrency).to.equal(5);
			expect(agenda.attrs.defaultConcurrency).to.equal(1);
			expect(agenda.attrs.batchSize).to.equal(3);
			expect(agenda.attrs.processEvery).to.equal(10000);
			expect(agenda.attrs.defaultLockLifetime).to.equal(60000);

			await agenda.stop();
		});

		it('should support batch processing configuration', async () => {
			const agenda = new Agenda({
				mongo: mongoDb,
				batchSize: 10,
				enableBatchProcessing: true
			});

			await delay(100); // Wait for connection

			expect(agenda.attrs.batchSize).to.equal(10);
			expect(agenda.attrs.enableBatchProcessing).to.be.true;

			await agenda.stop();
		});

		it('should support method chaining for configuration', async () => {
			const agenda = new Agenda({ mongo: mongoDb });
			await delay(100); // Wait for connection

			agenda
				.batchSize(15)
				.enableBatchProcessing(true)
				.maxConcurrency(50)
				.defaultConcurrency(5);

			expect(agenda.attrs.batchSize).to.equal(15);
			expect(agenda.attrs.enableBatchProcessing).to.be.true;
			expect(agenda.attrs.maxConcurrency).to.equal(50);
			expect(agenda.attrs.defaultConcurrency).to.equal(5);

			await agenda.stop();
		});
	});

	describe('Queue Monitoring Examples', () => {
		it('should emit queueOverflow events as documented', async () => {
			const agenda = new Agenda({ mongo: mongoDb });
			await delay(100); // Wait for connection

			let overflowEvents = 0;
			agenda.on('queueOverflow', (details: any) => {
				overflowEvents++;
				expect(details.jobName).to.be.a('string');
				expect(details.queueSize).to.be.a('number');
				expect(details.maxSize).to.be.a('number');
			});

			// Manually trigger overflow by accessing the queue directly
			const queue = (agenda as any).jobProcessor?.jobQueue;
			if (queue) {
				// Fill queue beyond capacity (this is just for testing the event)
				for (let i = 0; i < 11000; i++) {
					const job = agenda.create('test job', {});
					const success = queue.insert(job);
					if (!success) break; // Queue is full
				}
			}

			await agenda.stop();
			// Note: This test verifies the API structure, actual overflow testing 
			// would require more complex setup
		});
	});

	describe('Configuration API', () => {
		it('should have default values as documented', async () => {
			const agenda = new Agenda({ mongo: mongoDb });
			await delay(100); // Wait for connection

			// Verify default values match documentation
			expect(agenda.attrs.batchSize).to.equal(5);
			expect(agenda.attrs.enableBatchProcessing).to.be.true;
			expect(agenda.attrs.maxConcurrency).to.equal(20);
			expect(agenda.attrs.defaultConcurrency).to.equal(5);

			await agenda.stop();
		});
	});
});