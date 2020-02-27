const express = require('express');
const path = require('path');
const PORT = process.env.PORT || 5000;

const app = express();

app
  .use(express.static(path.join(__dirname, 'public')))
  .set('views', path.join(__dirname, 'views'))
  .set('view engine', 'ejs')
  .get('/', (req, res) => res.render('pages/index'));

app.get('/api/scheduled-sessions/:scheduledSessionId', (req, res, next) => {
   const id = req.params.scheduledSessionId;
   res.send(`schedulesSessionIdEntered: ${id}`);
});

app.get('/api/session-series/:sessionSeriesId', (req, res, next) => {
   const id = req.params.sessionSeriesId;
   res.send(`sessionSeriesIdEntered: ${id}`);
});



app.listen(PORT, () => console.log(`Listening on ${ PORT }`));
