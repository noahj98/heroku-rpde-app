const { Client } = require('pg');
const format = require('pg-format');
const axios = require('axios');
const PORT = process.env.PORT || 5000;

const urls = [
   'https://opendata.exercise-anywhere.com/api/rpde/session-series',
   'https://opendata.exercise-anywhere.com/api/rpde/scheduled-sessions'
];

const INSERT_QUERY = 'INSERT INTO Item(id, kind, data) VALUES ($1, $2, $3)';
const REMOVE_QUERY = 'DELETE FROM Item I WHERE I.id=$1';

async function startUpdatingSQL(client) {
   await client.query('DROP TABLE IF EXISTS Item')
      .catch(console.warn);
   await client.query(`CREATE TABLE Item (
   id text PRIMARY KEY,
   kind text NOT NULL,
   data jsonb NOT NULL
   )`).catch(console.warn);

   /*
    * RPDE rate limited, Heroku scheduler only works in 10 minute intervals on the free tier
    * So testing is done here in 5 second intervals
    *
    * What if this takes more than 5 seconds?
    */
   setInterval(async function() {
      console.log('updating sql');
      //axios request URLs
      //update URLs
      //update SQL
      //at some point test for invalid entries to send to another sql table
      const queries = [];
      for (let i in urls) {
	 axios.get(urls[i])
	    .then(async sessions => {
	       urls[i] = sessions.data.next;
	       const items = sessions.data.items.map(item => [item.id, item.kind, item.data, item.state]); //removes timestamp
	       for (let item in items) {
		  const curr = items[item];
		  if (curr.pop() === 'deleted')
		     queries.push(client.query(REMOVE_QUERY, [curr[0]])); //remove query with item.id
		  else
		     queries.push(client.query(INSERT_QUERY, curr)); //insert qry with item's id, kind, and data
	       }
	       Promise.all(queries).catch(console.warn);
	    })
	    .catch(console.warn);
      }
   }, 5000);
}

module.exports = { startUpdatingSQL };
