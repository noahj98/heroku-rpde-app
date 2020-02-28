const express = require('express');
const path = require('path');
const { Client } = require('pg');
const format = require('pg-format');
const axios = require('axios');
const PORT = process.env.PORT || 5000;

const client = new Client({
   connectionString: 'postgres://pylsifcdfthvis:345ce853381e034d447b00614a42d39399c06441b49c10fb9bb4cd39251c1c32@ec2-50-17-178-87.compute-1.amazonaws.com:5432/d587fbp61eu131',
   ssl: true,
});

async function setup() {

   await client.connect();
   await dropAndRecreateTableSchema();

   const app = express();

   app
      .use(express.static(path.join(__dirname, 'public')))
      .set('views', path.join(__dirname, 'views'))
      .set('view engine', 'ejs')
      .get('/', (req, res) => res.render('pages/index'));

   app.get('/api/scheduled-sessions/:scheduledSessionId', async (req, res, next) => {
      const id = req.params.scheduledSessionId;
      const qry = await getItemFromClient(id, 'ScheduledSession');
      const session = qry.rows[0];
      
      if (session)
	 //now query for parent - edge case where parent DNE either because i have not added it or it has been deleted
	 //and scheduled session should be deleted but has not been updated
	 res.send(session.data);
      else
	 res.status(404).send(`An error has occurred - there is no scheduled session with id ${id}`);
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

   app.get('/api/update-all', async (req, res, next) => {
      await dropAndRecreateTableSchema();
      const sessionSeries = updateFromUrl('https://opendata.exercise-anywhere.com/api/rpde/session-series');
      const scheduledSessions = updateFromUrl('https://opendata.exercise-anywhere.com/api/rpde/scheduled-sessions');
      
      try {
	 await Promise.all([sessionSeries, scheduledSessions]);
	 const qry = await client.query('SELECT * FROM Item');
	 res.send(qry.rows.map(item => [item.id, item.kind]));
      } catch (err) {
	 res.status(500).send('an error has occurred');
	 console.log(err);
      }
   });

      app.listen(PORT, () => console.log(`Listening on ${ PORT }`));
   }

setup();

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

async function updateFromUrl(url) {
   await axios.get(url)
      .then(async sessions => {
	 //table data and insert into table
	 const items = sessions.data.items.filter(item => item.state !== 'deleted').map(item => [item.id, item.kind, item.data]); //needed later for updating potentially
	 //const all = await format.withArray('INSERT INTO Item(id, kind, data) VALUES %L', items);

	 let queries = [];
	 for (let item in items) {
	    queries.push(client.query('INSERT INTO Item(id, kind, data) VALUES ($1, $2, $3)', items[item]));
	 }
	 await Promise.all(queries);
      });
}

async function getItemFromClient(id, kind) {
   return client.query('SELECT * FROM Item I WHERE I.id=$1 AND I.kind=$2', [id, kind]);
}
