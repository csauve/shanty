var config = require("config");
var events = require("events");
var util = require("util");
var Datastore = require("nedb");
var path = require("path");

//db setup
var downloads = new Datastore({
    filename: path.join(config.downloadsPath, "downloads.db"),
    autoload: true
});

var downloaders = {};

var Downloader = function(downloadId) {
    events.EventEmitter.call(this);
    var self = this;

    //start the downloader at the right stage
    downloads.findOne({_id: downloadId}, function(error, download) {
        if (!error) {
            if (download.status == "Queued") {
                executeDownload(download);
            } else if (download.status == "Downloader") {
                console.log("todo...");
            } else {
                done(download);
            }
        }
    });

    function executeDownload(download) {
        if (download.url.indexOf("youtube.com") != -1) {
            downloadFromYoutube(download);
        } else {
            failure(download, "Unsupported media source")
        }
    }

    function downloadFromYoutube(download) {
        console.log("Downloading from youtube: " + download.url);
        download.status = "Downloading";
        self.emit("downloading", download);

        //work...
        setTimeout(function() {
            //...
            download.status = "Downloaded";
            downloads.update({_id: downloadId}, download, {}, function(err, numReplaced) {
                if (err) {
                    console.error(err);
                    return failure(download, "Failed to update status to Downloaded");
                }
                self.emit("downloaded", download);

                process.nextTick(function() {
                    done(download);
                });
            });
        }, 5000);
    }

    function done(download) {
        download.status = "Done";
        download.dateCompleted = new Date();
        downloads.update({_id: downloadId}, download, {}, function(err, numReplaced) {
            if (err) {
                console.error(err);
                return failure(download, "Failed to update status to Done");
            }
            console.log("Completed " + download.url);
            self.emit("done", download);
        });
    }

    function failure(download, message) {
        downloads.remove({_id: downloadId}, {}, function(err, numRemoved) {
            if (err) console.error(err);
            download.status = "Failed";
            download.errorMessage = message;
            self.emit("failure", download);
        });
    }
};

util.inherits(Downloader, events.EventEmitter);


function startDownloader(downloadId) {
    if (!downloaders[downloadId]) {
        var downloader = new Downloader(downloadId);
        downloaders[downloadId] = downloader;

        downloader.on("done", function(download) {
            delete downloaders[downloadId];
        });
        downloader.on("failure", function(download) {
            delete downloaders[downloadId];
        });
    }
}

function resumeDownloads() {
    downloads.find({status: {$ne: "Done"}}, function(err, downloads) {
        if (err) {
            return console.error("Failed to resume downloads");
        }
        downloads.forEach(function(download) {
            startDownloader(download._id);
        });
    });
}

resumeDownloads();

module.exports = {
    getDownloads: function(sessionId, callback) {
        downloads.find({sessionId: sessionId}, callback);
    },

    getDownloader: function(downloadId) {
        return downloaders[downloadId];
    },

    enqueue: function(sessionId, url, callback) {
        downloads.insert({
            sessionId: sessionId,
            url: url,
            status: "Queued",
            dateStarted: new Date()
        }, function(error, download) {
            if (!error) {
                startDownloader(download._id);
            }
            callback(error, download);
        });
    }
};
