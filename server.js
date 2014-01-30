'use strict';
var crypto = require('crypto');
var connect = require('connect');
var Q = require('q');
var fetchComponents = require('./component-list');
var http = require('http');
var registry;
var entity;

var HTTP_PORT = process.env.PORT || 8011;
//interval for updating old repos
var UPDATE_OLD_REPOS_INTERVAL_IN_DAYS =  7;
//interval for fetching new repos
var UPDATE_NEW_REPOS_INTERVAL_IN_MINUTES = 60;

function startKeepAlive() {
  setInterval(function() {
    var options = {
        host: 'boiler-plugins-list.herokuapp.com',
        port: 80,
        path: '/'
    };
    http.get(options, function(res) {
      res.on('data', function(chunk) {
        try {
          // optional logging... disable after it's working
          console.log("HEROKU RESPONSE: " + chunk);
        } catch (err) {
          console.log(err.message);
        }
      });
    }).on('error', function(err) {
     console.log("Error: " + err.message);
    });
  }, 20 * 60 * 1000); // load every 20 minutes
}

startKeepAlive();

function createEntity(list) {
	var obj = {json: JSON.stringify(list)};
	var shasum = crypto.createHash('sha1');
	shasum.update(obj.json);
	obj.etag = shasum.digest('hex');
	return obj;
}

function createCustomEntity(keyword) {
	return createEntity(registry.filter(function (el) {
		return el.keywords && el.keywords.indexOf(keyword) !== -1;
	}));
}

function getComponentListEntity(fetchNew) {
	fetchComponents(fetchNew || false).then(function (list) {
		console.log('Finished fetching data from GitHub', '' + new Date());

		registry = list.filter(function (el) {
			return el != null;
		});

		entity = createEntity(registry);
	}).fail(function (err) {
		console.log('fetchComponents error', err);
	});
}

function serveComponentList(request, response, next) {
	if (!entity) {
		console.error('Entity empty. Registry might not have finished fetching yet.');
		response.statusCode = 418;
		response.end();
		return;
	}

	var localEntity = entity;
	var matches = /^\/keyword\/([\w-]+)/.exec(request._parsedUrl.pathname);

	if (matches) {
		localEntity = createCustomEntity(matches[1]);
	}

	response.setHeader('ETag', localEntity.etag);
	response.setHeader('Access-Control-Allow-Origin', '*');
	response.setHeader('Content-Type', 'application/json');

	if (request.headers['if-none-match'] === localEntity.etag) {
		response.statusCode = 304;
		response.end();
		return;
	}

	response.statusCode = 200;
	response.end(new Buffer(localEntity.json));
}

getComponentListEntity();

connect()
	.use(connect.errorHandler())
	.use(connect.timeout(60000))
	.use(connect.logger('dev'))
	.use(connect.compress())
	.use(serveComponentList)
	.listen(HTTP_PORT);

//interval for getting old repository every week
setInterval(getComponentListEntity, UPDATE_OLD_REPOS_INTERVAL_IN_DAYS * 24 * 60 * 60 * 1000);

//interval for fetching new repos
setInterval(function () {
	getComponentListEntity(true);
}, UPDATE_NEW_REPOS_INTERVAL_IN_MINUTES * 60 * 1000);

console.log('Server running on port ' + HTTP_PORT);
