var config = require("config");
var events = require("events");
var util = require("util");
var Datastore = require("nedb");
var path = require("path");
var fs = require("fs");
var ytdl = require("ytdl");
var mkdirp = require("mkdirp");
var FFmpeg = require("fluent-ffmpeg");
var taglib = require("taglib");
var moment = require("moment");

var downloads = new Datastore({
    filename: path.join(config.downloadsDir, "downloads.db"),
    autoload: true
});

function getPath(download, extension) {
    return path.join(config.downloadsDir, download._id + "." + extension);
}

function DownloaderService() {
    events.EventEmitter.call(this);
    var self = this;

    function emitUpdated(download, status, callback) {
        download.status = status;
        self.emit("download-updated", download);
        if (callback) downloads.update({_id: download._id}, download, {}, function(err, numReplaced) {
            callback(err);
        });
    }

    function emitFailure(download, error) {
        if (error) console.error(error);
        //todo: remove files too
        downloads.remove({_id: download._id}, {}, function(err, numRemoved) {
            if (err) console.error(err);
            download.status = "Failed";
            self.emit("download-updated", download);
        });
    }

    function expireDownload(download) {
        downloads.remove({_id: download._id}, {}, function(error, numRemoved) {
            if (error) console.error("Failed to expire " + download._id + " from datastore");
            else emitUpdated(download, "Expired");
        });
        var mp3Path = getPath(download, "mp3");
        var flvPath = getPath(download, "flv");
        fs.exists(mp3Path, function(exists) {
            if (exists) fs.unlink(mp3Path, function(error) {
                if (error) console.error("Failed to remove " + mp3Path);
            });
        });
        fs.exists(flvPath, function(exists) {
            if (exists) fs.unlink(flvPath, function(error) {
                if (error) console.error("Failed to remove " + flvPath);
            });
        });
    }

    (function hourly() {
        var cutoff = moment().subtract("hours", config.maxStorageTimeHours);
        downloads.find({dateQueued: {$lt: cutoff}, status: "Ready"}, function(error, downloads) {
            if (error) return console.error(error);
            if (downloads.length > 0) console.log("Expiring " + downloads.length + " downloads");
            downloads.forEach(function(download) {
                expireDownload(download);
            });
        });
        setTimeout(hourly, 60 * 60 * 1000);
    })();

    function downloadMedia(download) {
        mkdirp(config.downloadsDir, function(error) {
            if (error) return emitFailure(download, error);
            emitUpdated(download, "Downloading");
            if (download.url.indexOf("youtube.com") != -1) downloadFromYoutube(download);
            else emitFailure(download, "Unsupported media source: " + download.url);
        });
    }

    function downloadFromYoutube(download) {
        console.log("Downloading from youtube: " + download.url);
        ytdl.getInfo(download.url, function(error, info) {
            if (error) return emitFailure(download, error);

            var match = info.title.match(new RegExp("(.+) - (.+(?: \\(.+\\))?)", "i"));
            download.metadata = match ? {
                artist: match[1],
                title: match[2]
            } : {};
            
            var flvPath = getPath(download, "flv");
            var flvFile = fs.createWriteStream(flvPath);
            ytdl(download.url).pipe(flvFile);

            flvFile.on("close", function() {
                emitUpdated(download, "Downloaded", function(error) {
                    if (error) return emitFailure(download, error);
                    convertMedia(download, flvPath);
                });
            });
        });
    }

    function convertMedia(download, flvPath) {
        console.log("Converting FLV to MP3: " + flvPath);
        emitUpdated(download, "Converting");
        var dstPath = getPath(download, "mp3");

        new FFmpeg({source: flvPath, nolog: true})
        .withAudioCodec("libmp3lame")
        .toFormat("mp3")
        .saveToFile(dstPath, function(retcode, stderr) {
            //retcode and stderr useless?
            fs.unlinkSync(flvPath);
            emitUpdated(download, "Untagged", function(error) {
                if (error) return emitFailure(download, error);
                applyMetadata(download);
            });
        });
    }

    function applyMetadata(applyDownload) {
        downloads.findOne({_id: applyDownload._id}, function(err, download) {
            if (err) return emitFailure(download, error);
            if (!download) return emitFailure(download, "Download does not exist");

            var mp3Path = getPath(download, "mp3");
            console.log("Applying metadata to " + mp3Path);
            //emitUpdated(download, "Applying Metadata");

            var tag = taglib.tagSync(mp3Path);
            for (key in applyDownload.metadata) {
                var value = applyDownload.metadata[key];
                if (value) tag[key] = value;
            }
            tag.saveSync();

            download.metadata = applyDownload.metadata;
            emitUpdated(download, "Ready", function(error) {
                if (error) return emitFailure(download, error);
            });
        });
    }

    self.applyMetadata = applyMetadata;

    self.resumeDownloads = function() {
        downloads.find({status: {$ne: "Ready"}}, function(err, downloads) {
            if (err) return console.error("Failed to resume downloads");
            downloads.forEach(function(download) {
                if (download.status == "Queued") downloadMedia(download);
                else if (download.status == "Downloaded") convertMedia(download);
                else if (download.status == "Untagged") applyMetadata(download);
            });
        });
    };

    self.getDownloads = function(sessionId, callback) {
        downloads.find({sessionId: sessionId}, callback);
    };

    self.enqueue = function(sessionId, url, callback) {
        downloads.insert({
            sessionId: sessionId,
            status: "Queued",
            url: url,
            dateQueued: new Date()
        }, function(error, download) {
            if (!error) {
                downloadMedia(download);
            }
            callback(error, download);
        });
    };

    self.getMp3 = function(downloadId, callback) {
        downloads.findOne({_id: downloadId}, function(error, download) {
            var mp3Path = getPath(download, "mp3");
            callback(error, download, mp3Path);
        });
    };
};

util.inherits(DownloaderService, events.EventEmitter);
var service = new DownloaderService();
service.setMaxListeners(0);
module.exports = service;