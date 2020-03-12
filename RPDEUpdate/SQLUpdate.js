const { Client } = require('pg');
const format = requre('pg-format');
const axios = require('axios');
const PORT = process.env.PORT || 5000;
/*
const client = new Client({
   connectionString: process.env.DATABASE_URL,
   ssl: true,
});
*/
export async function startUpdatingSQL(client) {

   /*
    * RPDE rate limited, Heroku scheduler only works in 10 minute intervals on the free tier
    * So testing is done here
    */
   setInterval(function() {
      console.log('hello');
   }, 5000);
}
