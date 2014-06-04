var config = require("config");
var Datastore = require("nedb");
var express = require("express");
var io = require("socket.io");
var mime = require("mime");
var downloaderService = require("./downloaderService");
var sanitize = require("sanitize-filename");
var fs = require("fs");

var app = express();
app.use(express.static("static"));
var server = require("http").Server(app);
var socket = io(server);

server.listen(config.port, function() {
    console.log("Listening on port " + config.port);
});

socket.on("connection", function(client) {
    client.on("ready", function(cookieSessionId) {
        client.sessionId = cookieSessionId || client.id;

        downloaderService.getDownloads(client.sessionId, function(error, downloads) {
            if (error) return console.error(error);
            client.emit("welcome", {downloads: downloads, sessionId: client.sessionId});

            var downloadUpdatedHandler = function(download) {
                if (download.sessionId == client.sessionId) {
                    client.emit("download-updated", download);
                }
            }

            downloaderService.on("download-updated", downloadUpdatedHandler);
            client.on("disconnect", function() {
                downloaderService.removeListener("download-updated", downloadUpdatedHandler);
            });
        });
    });

    client.on("queue-download", function(url) {
        downloaderService.enqueue(client.sessionId, url, function(error, download) {
            if (error) return console.error(error);
            client.emit("download-updated", download);
        });
    });

    client.on("apply-metadata", function(download) {
        downloaderService.applyMetadata(download);
    });
});

app.get("/download/:id", function(req, res) {
    downloaderService.getMp3(req.params.id, function(error, download, mp3Path) {
        if (error) return res.send(500);
        if (!download || !mp3Path) return res.send(404);
        var filename = sanitize(download.metadata.artist + " - " + download.metadata.title + ".mp3");
        res.setHeader("Content-disposition", "attachment; filename=" + filename);
        res.setHeader("Content-type", mime.lookup(mp3Path));
        fs.createReadStream(mp3Path).pipe(res);
    });
});

downloaderService.resumeDownloads();