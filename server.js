// Production entry point for Plesk/Passenger
// Wraps startup in try/catch to log errors visibly
try {
  require('./server-dist/index.js');
} catch (err) {
  // Write crash reason to a file the admin can check
  var fs = require('fs');
  var path = require('path');
  var logFile = path.join(__dirname, 'startup-error.log');
  var msg = new Date().toISOString() + ' STARTUP CRASH:\n' + (err && err.stack ? err.stack : err) + '\n\n';
  fs.appendFileSync(logFile, msg);

  // Also start a minimal HTTP server that shows the error
  var http = require('http');
  var server = http.createServer(function(req, res) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Server startup failed',
      message: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : undefined
    }));
  });
  server.listen(process.env.PORT || 3001);
}
