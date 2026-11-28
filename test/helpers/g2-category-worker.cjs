const db = require('./db');
const categories = require('../../controllers/admin/category.controller');
const tour = require('../../controllers/admin/tour.controller');

async function run() {
  await db.connect();
  process.once('disconnect', () => db.close());
  process.once('message', async ({ category, actorId, action = 'tour-create', tourId, reportStart }) => {
    try {
      const req = {
        account: { id: actorId }, permissions: ['tour-create'], flash() {},
        body: { name: 'G2 Cross-process tour', category, position: '1', status: 'active' }
      };
      const res = { status() { return this; }, json(result) { process.send(result.code); } };
      let write;
      if (action === 'category-create') {
        req.categoryInput = { name: 'G2.1 Cross-process child', parent: category, position: 1, status: 'active' };
        write = categories.createPost(req, res);
      } else if (action === 'tour-edit') {
        req.params = { id: tourId };
        req.permissions = ['tour-edit'];
        req.body.name = 'G2.1 Cross-process linked tour';
        write = tour.editPatch(req, res);
      } else {
        write = tour.createPost(req, res);
      }
      if (reportStart) process.send('started');
      await write;
    } catch (error) {
      process.send('worker error: ' + error.name);
    }
  });
  process.send('ready');
}

run().catch(async error => {
  console.error(error.message);
  await db.close();
  process.exitCode = 1;
});
