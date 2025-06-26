import { expect } from 'chai';
import { Db } from 'mongodb';
import { Agenda } from '../src';
import { Job } from '../src/Job';
import { mockMongo } from './helpers/mock-mongodb';
import * as delay from 'delay';

// Test for batch processing functionality
describe('Batch Processing', () => {
	let agenda: Agenda;
	let mongoDb: Db;
	let mongoCfg: string;

	beforeEach(async () => {
		if (!mongoDb) {
			const mockedMongo = await mockMongo();
			mongoCfg = mockedMongo.uri;
			mongoDb = mockedMongo.mongo.db();
		}

		return new Promise(resolve => {
			agenda = new Agenda(
				{
					mongo: mongoDb,
					batchSize: 3 // Test with batch size of 3
				},
				async () => {
					await delay(50);
					await mongoDb.collection('agendaJobs').deleteMany({});
					agenda.define('batch test job', () => {});
					agenda.define('single test job', () => {});
					return resolve();
				}
			);
		});
	});

	afterEach(async () => {
		await delay(50);
		await agenda.stop();
		await mongoDb.collection('agendaJobs').deleteMany({});
	});

	describe('batchGetNextJobsToRun', () => {
		it('should return empty array when no jobs available', async () => {
			const jobs = await agenda.db.batchGetNextJobsToRun(
				'batch test job',
				3,
				new Date(Date.now() + 10000),
				new Date(Date.now() - 10000)
			);
			expect(jobs).to.be.an('array');
			expect(jobs).to.have.length(0);
		});

		it('should return single job when only one available', async () => {
			// Create a single job
			const job = agenda.create('batch test job', { testData: 'single' });
			await job.save();

			const jobs = await agenda.db.batchGetNextJobsToRun(
				'batch test job',
				3,
				new Date(Date.now() + 10000),
				new Date(Date.now() - 10000)
			);

			expect(jobs).to.have.length(1);
			expect(jobs[0].name).to.equal('batch test job');
			expect((jobs[0].data as any).testData).to.equal('single');
			expect(jobs[0].lockedAt).to.be.a('date');
		});

		it('should return multiple jobs up to batch size', async () => {
			// Create 5 jobs
			for (let i = 0; i < 5; i++) {
				const job = agenda.create('batch test job', { testData: `job-${i}` });
				await job.save();
			}

			const jobs = await agenda.db.batchGetNextJobsToRun(
				'batch test job',
				3,
				new Date(Date.now() + 10000),
				new Date(Date.now() - 10000)
			);

			expect(jobs).to.have.length(3);
			jobs.forEach(job => {
				expect(job.name).to.equal('batch test job');
				expect(job.lockedAt).to.be.a('date');
			});
		});

		it('should not return already locked jobs', async () => {
			// Create 3 jobs
			for (let i = 0; i < 3; i++) {
				const job = agenda.create('batch test job', { testData: `job-${i}` });
				await job.save();
			}

			// Lock one job manually
			const firstBatch = await agenda.db.batchGetNextJobsToRun(
				'batch test job',
				1,
				new Date(Date.now() + 10000),
				new Date(Date.now() - 10000)
			);
			expect(firstBatch).to.have.length(1);

			// Try to get more jobs - should only get the remaining unlocked ones
			const secondBatch = await agenda.db.batchGetNextJobsToRun(
				'batch test job',
				3,
				new Date(Date.now() + 10000),
				new Date(Date.now() - 10000)
			);
			expect(secondBatch).to.have.length(2);
		});

		it('should handle write conflicts gracefully', async () => {
			// Create jobs
			for (let i = 0; i < 3; i++) {
				const job = agenda.create('batch test job', { testData: `job-${i}` });
				await job.save();
			}

			// Simulate concurrent access
			const promises = Array(5).fill(0).map(() =>
				agenda.db.batchGetNextJobsToRun(
					'batch test job',
					2,
					new Date(Date.now() + 10000),
					new Date(Date.now() - 10000)
				)
			);

			const results = await Promise.all(promises);
			
			// Should have gotten some jobs, but total locked should not exceed available
			const totalJobsLocked = results.reduce((sum, jobs) => sum + jobs.length, 0);
			expect(totalJobsLocked).to.be.lessThanOrEqual(3);
		});

		it('should respect job scheduling time', async () => {
			// Create a job scheduled for the future
			const futureJob = agenda.create('batch test job', { testData: 'future' });
			futureJob.schedule(new Date(Date.now() + 60000)); // 1 minute from now
			await futureJob.save();

			// Create a job that should run now
			const nowJob = agenda.create('batch test job', { testData: 'now' });
			await nowJob.save();

			const jobs = await agenda.db.batchGetNextJobsToRun(
				'batch test job',
				3,
				new Date(Date.now() + 10000), // nextScanAt
				new Date(Date.now() - 10000)  // lockDeadline
			);

			expect(jobs).to.have.length(1);
			expect((jobs[0].data as any).testData).to.equal('now');
		});

		it('should handle expired locks', async () => {
			// Create a job and lock it with an old timestamp
			const job = agenda.create('batch test job', { testData: 'expired' });
			await job.save();

			// Manually set an expired lock
			await mongoDb.collection('agendaJobs').updateOne(
				{ _id: job.attrs._id },
				{ $set: { lockedAt: new Date(Date.now() - 60000) } } // 1 minute ago
			);

			const jobs = await agenda.db.batchGetNextJobsToRun(
				'batch test job',
				3,
				new Date(Date.now() + 10000),
				new Date(Date.now() - 30000) // Consider locks older than 30 seconds as expired
			);

			expect(jobs).to.have.length(1);
			expect((jobs[0].data as any).testData).to.equal('expired');
		});
	});

	describe('batch processing configuration', () => {
		it('should use default batch size when not specified', async () => {
			const agendaWithDefaults = new Agenda({ mongo: mongoDb });
			await delay(100);
			
			// Should have default batch size (we'll set this to 5)
			expect(agendaWithDefaults.attrs.batchSize).to.equal(5);
			
			await agendaWithDefaults.stop();
		});

		it('should use custom batch size when specified', async () => {
			expect(agenda.attrs.batchSize).to.equal(3);
		});

		it('should allow disabling batch processing', async () => {
			const agendaWithoutBatch = new Agenda({ 
				mongo: mongoDb, 
				enableBatchProcessing: false 
			});
			await delay(100);
			
			expect(agendaWithoutBatch.attrs.enableBatchProcessing).to.be.false;
			
			await agendaWithoutBatch.stop();
		});
	});

	describe('integration with JobProcessor', () => {
		it('should process multiple jobs when batch processing is enabled', async () => {
			let processedJobs = 0;
			
			agenda.define('batch integration test', async () => {
				processedJobs++;
				await delay(10);
			});

			// Create 5 jobs
			for (let i = 0; i < 5; i++) {
				const job = agenda.create('batch integration test', { index: i });
				await job.save();
			}

			await agenda.start();
			
			// Wait for jobs to be processed
			await delay(1500);
			
			expect(processedJobs).to.equal(5);
		});

		it('should use batch processing when available slots allow it', async () => {
			// Test that JobProcessor uses batch method when it makes sense
			let batchCalls = 0;
			let singleCalls = 0;

			// Spy on the batch method
			const originalBatch = agenda.db.batchGetNextJobsToRun;
			const originalSingle = agenda.db.getNextJobToRun;

			agenda.db.batchGetNextJobsToRun = async (...args) => {
				batchCalls++;
				return originalBatch.apply(agenda.db, args);
			};

			agenda.db.getNextJobToRun = async (...args) => {
				singleCalls++;
				return originalSingle.apply(agenda.db, args);
			};

			agenda.define('batch spy test', async () => {
				await delay(10);
			});

			// Create 6 jobs (more than batch size of 3)
			for (let i = 0; i < 6; i++) {
				const job = agenda.create('batch spy test', { index: i });
				await job.save();
			}

			await agenda.start();
			await delay(1000);
			await agenda.stop();

			// Should have made at least one batch call
			expect(batchCalls).to.be.greaterThan(0);

			// Restore original methods
			agenda.db.batchGetNextJobsToRun = originalBatch;
			agenda.db.getNextJobToRun = originalSingle;
		});

		it('should fall back to single job processing when batch size is 1', async () => {
			const singleBatchAgenda = new Agenda({
				mongo: mongoDb,
				batchSize: 1
			});
			await delay(100);

			let processedJobs = 0;
			singleBatchAgenda.define('single batch test', async () => {
				processedJobs++;
				await delay(10);
			});

			// Create 3 jobs
			for (let i = 0; i < 3; i++) {
				const job = singleBatchAgenda.create('single batch test', { index: i });
				await job.save();
			}

			await singleBatchAgenda.start();
			await delay(1000);
			await singleBatchAgenda.stop();

			expect(processedJobs).to.equal(3);
		});

		it('should not use batch processing when disabled', async () => {
			const noBatchAgenda = new Agenda({
				mongo: mongoDb,
				enableBatchProcessing: false
			});
			await delay(100);

			let processedJobs = 0;
			noBatchAgenda.define('no batch test', async () => {
				processedJobs++;
				await delay(10);
			});

			// Create 3 jobs
			for (let i = 0; i < 3; i++) {
				const job = noBatchAgenda.create('no batch test', { index: i });
				await job.save();
			}

			await noBatchAgenda.start();
			await delay(1000);
			await noBatchAgenda.stop();

			expect(processedJobs).to.equal(3);
		});
	});
});