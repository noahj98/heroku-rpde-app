const express = require('express');
const path = require('path');
const { Client } = require('pg');
const format = require('pg-format');
const axios = require('axios');
const PORT = process.env.PORT || 5000;

/*
 * Customer requirement 1:
 *    There's a rate limit on the RPDE feed - one every five seconds max
 *
 * Infra requirement 1:
 *    Heroku Scheduler must be used for cron jobs
 *
 * Customer requirement 2:
 *    We only want to see valid items
 *
 * Infra requirement 2:
 *    RabbitMQ must be used to create a data pipeline
 *
 * Break RPDE pages into items and then publish each item to RabbitMQ so that it can be consumed by the 1st RabbitMQ consumer
 *
 * Need 2 RabbitMQ consumers:
 *    1: Validate. This uses https://github.com/openactive/data-model-validator to check each item for conformance to the Modelling Spec
 *	 Items that have validation errors should be stored to an "errors" table in the db
 *	 Create a route that returns ALL the errant IDs along with error messages
 *	 Items that pass validation can be send to a queue to be consumed by the persister
 *    2: Persist. This stores items in PostgreSQL. Only valid items should be sent here to be persisted
 */

const client = new Client({
   connectionString: process.env.DATABASE_URL || 'postgres://pylsifcdfthvis:345ce853381e034d447b00614a42d39399c06441b49c10fb9bb4cd39251c1c32@ec2-50-17-178-87.compute-1.amazonaws.com:5432/d587fbp61eu131',
   ssl: true,
});

//const sessionSeriesUrl = 'https://opendata.exercise-anywhere.com/api/rpde/session-series';
//const scheduledSessionsUrl = 'https://opendata.exercise-anywhere.com/api/rpde/scheduled-sessions';

async function setup() {

   await client.connect();

   const app = express();

   app
      .use(express.static(path.join(__dirname, 'public')))
      .set('views', path.join(__dirname, 'views'))
      .set('view engine', 'ejs')
      .get('/', (req, res) => res.render('pages/index'));

   /*
    * Queries PostgreSQL database for all scheduled sessions
    * Returns list of all ids
    */
   app.get('/api/scheduled-sessions', async (req, res, next) => {
      res.locals.kind = 'ScheduledSession';
      next();
      //client.query('SELECT * FROM Item I WHERE I.kind=$1', ['ScheduledSession'])
      //.then(data => res.send(data.rows.map(item => item.id)))
      //.catch(err => res.status(500).send('An internal server error has occurred'));
   }, getKindFromDB);

   /*
    * Queries PostgreSQL database for all session series
    * Returns list of all ids
    */
   app.get('/api/session-series', async (req, res, next) => {
      res.locals.kind = 'SessionSeries';
      next();
      //client.query('SELECT * FROM Item I WHERE I.kind=$1', ['SessionSeries'])
      //.then(data => res.send(data.rows.map(item => item.id)))
      //.catch(err => res.status(500).send('An error has occurred'));
   }, getKindFromDB);

   async function getKindFromDB(req, res, next) => {
      client.query('SELECT * FROM Item I WHERE I.kind=$1', [res.locals.kind])
	 .then(data => res.send(data.rows.map(item => item.id)))
	 .catch(err => res.status(500).send('An internal server error has occurred'));
   }

   app.get('/api/scheduled-sessions/:scheduledSessionId', async (req, res, next) => {
      try {
      const id = req.params.scheduledSessionId;
      const qry = await getItemFromClient(id, 'ScheduledSession');
      const session = qry.rows[0];

      if (session) {
	 //now query for parent - edge case where parent DNE either because i have not added it or it has been deleted
	 //and scheduled session should be deleted but has not been updated
	 const parentId = String(session.data.superEvent).match(/\.com\/(.*)/)[1];
	 const qry2 = await getItemFromClient(parentId, 'SessionSeries');
	 session.data.superEvent = qry2.rows[0].data;
	 res.send(session.data);
      } else
	 res.status(404).send(`An error has occurred - there is no scheduled session with id ${id}`);
      } catch (err) {
	 console.log(err);
	 res.status(500).send('An internal server error has occurred');
      }
   });

   app.get('/api/session-series/:sessionSeriesId', async (req, res, next) => {
      const id = req.params.sessionSeriesId;
      const qry = await getItemFromClient(id, 'SessionSeries');
      const session = qry.rows[0];
      if (session) 
	 res.send(session.data);
      else
	 res.status(404).send(`An error has occurred - there is no session series with id ${id}`);
   });
/*
   app.get('/api/update-all', async (req, res, next) => {
      await dropAndRecreateTableSchema();
      const sessionSeries = updateFromUrl(sessionSeriesUrl);
      const scheduledSessions = updateFromUrl(scheduledSessionsUrl);
      //is it okay to do these simultaneously? brings me back to the semaphore days...
      try {
	 await Promise.all([sessionSeries, scheduledSessions]);
	 const qry = await client.query('SELECT * FROM Item');
	 res.send(qry.rows.map(item => [item.id, item.kind]));
      } catch (err) {
	 res.status(500).send('an error has occurred');
	 console.log(err);
      }
   });
*/
   app.listen(PORT, () => console.log(`Listening on ${ PORT }`));
}

setup();
/*
async function dropAndRecreateTableSchema() {
   await client.query('DROP TABLE IF EXISTS Item')
      .catch(err => {
	 throw err;
      });
   await client.query(`CREATE TABLE Item (
      id text PRIMARY KEY,
      kind text NOT NULL,
      data jsonb NOT NULL
   )`).catch(err => {
      throw err;
   });
}
*/
/*
async function updateFromUrl(url) {
   //make this a loop such that it keeps getting from the url until response is empty
   //need to be careful about deletes - need to alter query to deal with them
   //filter deletes
   for (let i = 0; i != -1;) {
      await axios.get(url)
	 .then(async sessions => {
	    //table data and insert into table
	    url = sessions.data.next;
	    const items = sessions.data.items.map(item => [item.id, item.kind, item.data, item.state]); 
	    //await format('INSERT INTO Item(id, kind, data) VALUES %L', items);
	    
	    if (items.length === 0) {
	       i = -1;
	       return;
	    }
	    let queries = [];
	    const insert_qry = 'INSERT INTO Item(id, kind, data) VALUES ($1, $2, $3)';
	    const remove_qry = 'DELETE FROM Item I WHERE I.id=$1';
	    for (let item in items) {
	       const cur = items[item];
	       if (cur.pop() === 'deleted')
		  queries.push(client.query(remove_qry, [cur[0]]));
	       else
		  queries.push(client.query(insert_qry, cur));
	    }
	    await Promise.all(queries);
	    
	 });
   }
}
*/

async function getItemFromClient(id, kind) {
   return client.query('SELECT * FROM Item I WHERE I.id=$1 AND I.kind=$2', [id, kind]);
}
