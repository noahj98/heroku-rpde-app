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
   connectionString: process.env.DATABASE_URL, //|| 'postgres://pylsifcdfthvis:345ce853381e034d447b00614a42d39399c06441b49c10fb9bb4cd39251c1c32@ec2-50-17-178-87.compute-1.amazonaws.com:5432/d587fbp61eu131',
   ssl: true,
});

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
   }, getKindFromDB);

   /*
    * Queries PostgreSQL database for all session series
    * Returns list of all ids
    */
   app.get('/api/session-series', async (req, res, next) => {
      res.locals.kind = 'SessionSeries';
      next();
   }, getKindFromDB);

   /*
    * Queries PostgreSQL database for all Items of some Item.kind
    * returns the Item.id of all returned Items
    */
   async function getKindFromDB(req, res, next) {
      client.query('SELECT * FROM Item I WHERE I.kind=$1', [res.locals.kind])
	 .then(data => res.send(data.rows.map(item => item.id)))
	 .catch(err => {
	    console.log(err);
	    res.status(500).send('An internal server error has occurred');
	 });
   }

   /*
    * Queries PostgreSQL database for scheduled session with requested id
    * Retrieves parentId from returned data, then queries PostgreSQL database for session series with parent id
    * Merges and returns data
    */
   app.get('/api/scheduled-sessions/:scheduledSessionId', async (req, res, next) => {
      //change such that query returns both? rather than two queries?
      const id = req.params.scheduledSessionId;
      getItemFromClient(id, 'ScheduledSession')
	 .then(async qry => {
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
	 }).catch(err => {
	    console.log(err);
	    res.status(500).send('An internal server error has occurred');
	 });
   });

   /* Queried PostgreSQL database for session series with requested id
    * Retrieves [childID(s)] from returned data, then queried PostgreSQL database for scheduled sessions with childrens ids
    * Merges and returns data
    *
    * Doesn't actually do this yet, though
    */
   app.get('/api/session-series/:sessionSeriesId', async (req, res, next) => {
      let id = req.params.sessionSeriesId;
      getItemFromClient(id, 'SessionSeries')
	 .then(async qry => {
	    const session = qry.rows[0];
	    if (session) {
	       id = 'https://opendata.exercise-anywhere.com/' + id;
	       const qry2 = await client.query(`SELECT * FROM Item I WHERE I.kind=$1 AND I.data ->> 'superEvent'=$2`, ['ScheduledSession', id]);
	       const item = session.data;
	       item.subEvent = qry2.rows;
	       res.send(item);
	    } else
	       res.status(404).send(`An error has occurred - there is no session series with id ${id}`);
	 }).catch(err => {
	    console.log(err);
	    res.status(500).send('An internal server error has occurred');
	 });
   });

   app.listen(PORT, () => console.log(`Listening on ${ PORT }`));
}

setup();

async function getItemFromClient(id, kind) {
   return client.query('SELECT * FROM Item I WHERE I.id=$1 AND I.kind=$2', [id, kind]);
}
