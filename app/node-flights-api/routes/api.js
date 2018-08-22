var applicationInsights = require('applicationinsights'),
    async = require('async'),
    cacheServiceUri = process.env.CACHE_SERVICE_URI
    express = require('express'),
    jsonResponse = require('../models/express/jsonResponse'),
    moment = require('moment'),
    path = require('path'),
    router = express.Router(),
    rp = require('request-promise'),
    st = require('../models/util/status'),
    site = require('../models/util/site')

var telemetry = applicationInsights.defaultClient

    const routename = path.basename(__filename).replace('.js', ' default endpoint for ' + site.name)

/* GET JSON :: Route Base Endpoint */
router.get('/', (req, res, next) => {

    jsonResponse.json( res, routename, st.OK.code, {} )
    
})



/* GET JSON :: All Flights in Air - No cache - No db version */
router.get('/current', (req, res, next) => {
    var querypath = 'all'
    var event = 'no_cache'
    getFlightData(querypath, event, (err, data) => {

        if (err) { 
            jsonResponse.json( res, st.ERR.msg, st.ERR.code, err)
            next()
        }

        buildGeoJson(data.states, (fmtError, flights) => {
            jsonResponse.json( res, st.OK.msg, st.OK.code, flights)
        })

    })
})


router.get('/refresh', (req, res, next) => {
    var querypath = 'all'
    
    async.waterfall([
        (cb) => {
            console.log('getting flight data')
            getFlightData(querypath, 'refreshflightdata', (err, data) => {
                cb(null, data)
            })
        },
        (data, cb) => {
            console.log('got flight data with ', data.states.length, ' flights')
            var currenttime = moment.unix(data.time).format('YYYYMMDDHHmm').toString()
            postCacheItem('flighttime', currenttime, site.CACHE_SET_FLIGHT_TIME, (err, reply) => {
                cb(null, data, currenttime)
            })
        },
        (data, timestamp, cb) => {
            console.log('building geojson')
            buildGeoJson(data.states, (err, result) => { 
                console.log(result)
                cb(null, result, timestamp)
            })
        },
        (data, key, cb) => {
            console.log('posted cache item - time ', key)
            //var flights = JSON.stringify(data.states)
            var out = data.toString()
            postCacheItem(key, out, site.CACHE_SET_FlIGHTS, (err, reply) => {
                cb(null, 'success')
            })
        }], 
        (e, r) => {
            console.log('posted cache item - flights')
            jsonResponse.json( res, st.OK.msg, st.OK.code, r)
    })

})


function getFlightData(querypath, event, cb) {
    console.log('rp to opensky:', querypath)

    // telemetry.trackEvent({name: event})
    var opt = { uri: 'https://opensky-network.org/api/states/' + querypath,
        headers: { 'User-Agent': 'Request-Promise' },
        json: true
    }
    
    rp(opt)
    .then(data => {
        cb(null, data)
    })
    .catch(err => {
        cb(err, null)
    })
    
}

function postCacheItem(key, data, event, cb){
    // telemetry.trackEvent({name: event})
    var url = cacheServiceUri + 'set/' + key
    var obj = JSON.stringify(data);
    console.log(url)
    console.log(obj)
    var opt = { method: 'POST',
        uri: url,
        headers: { 'User-Agent': 'Request-Promise' },
        body: obj,
        json: true
    }

    rp(opt)
      .then(out => {
        cb(null, out)
    })
    .catch(err => {
        cb(err, null)
    })
}

function getCacheItem(key, cb){
    var opt = { uri: cacheServiceUri + key,
        headers: { 'User-Agent': 'Request-Promise' },
        json: true
    }
    rp(opt)
    .then(data => {
      cb(null, data)
    })
    .catch(err => {
      cb(err, null)
    })
}

function buildGeoJson(flights, cb){
    var flightGeoJson = {'type':'FeatureCollection','features':[]}

    async.each(flights, (flight, callback) => {
        
        if ( flight[8] || flight[5] === null ) {
            callback()
        } else {
      

        
      /* create the GeoJSON feature for this flight */
      
        var feature = { 
          type: 'Feature',
          properties: {
            FlightNumber:flight[1].toString().replace(/ /g, ''),
            Country: flight[2],
            Altitude:flight[7], 
            AirSpeed:flight[9],
            Heading:flight[10]
          },
          geometry: { 
            type: 'Point',
            coordinates:[ flight[5], flight[6] ]
          }
        }

        /* Add this flights GeoJSON to the array */
        flightGeoJson.features.push(feature)
        callback()

    }

    }, (err) => {
        if(err){
            console.log(err)
            cb(err, null)
        }else{
            console.log('all flights processed successfully')
            cb(null, flightGeoJson)
        }
    })
}

module.exports = router