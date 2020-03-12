let q = 'tasks';

let url = process.env.CLOUDAMQP_URL || 'amqp://localhost';
let open = require('amqplib').connect(url);

//This is a consumer
open.then(function(conn) {
   let ok = conn.createChannel();
   ok = ok.then(function(ch) {
      ch.assertQueue(q);
      ch.consume(q, function(msg) {
	 if (msg !== null) {
	    console.log(msg.content.toString());
	    ch.ack(msg);
	 }
      });
   });
   return ok;
}).catch(console.warn);

//This is a producer
open.then(function(conn) {
   let ok = conn.createChannel();
   ok = ok.then(function(ch) {
      ch.assertQueue(q);
      ch.sendToQueue(q, new Buffer('something to do'));
   });
   return ok;
}).catch(console.warn);
