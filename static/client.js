function MainCtrl($scope) {
    var socket = io.connect();
    var Notification = window.Notification || window.mozNotification || window.webkitNotification;
    Notification.requestPermission();
    $scope.notify = true;

    socket.on("connect", function() {
        $scope.$apply(function() {
            $scope.disconnected = false;
            socket.emit("ready", $.cookie("sessionId"));
        });
    });

    socket.on("disconnect", function() {
        $scope.$apply(function() { $scope.disconnected = true; });
    });

    socket.on("welcome", function(data) {
        $.cookie("sessionId", data.sessionId, {expires: 7});
        $scope.$apply(function() { $scope.downloads = data.downloads || []; });
    });

    $scope.queueDownload = function() {
        console.dir($scope);
        if ($scope.formUrl) {
            socket.emit("queue-download", $scope.formUrl);
            $scope.formUrl = "";
        }
    };

    var timeout;
    $scope.metadataChanged = function(download) {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(function() {
            socket.emit("apply-metadata", download);
        }, 400);
    };

    $scope.removeMetadata = function(download, key) {
        delete download.metadata[key];
        $scope.metadataChanged(download);
    };

    $scope.getDownloadUrl = function(download) { return "/download/" + download._id; };

    $scope.availableMetadataKeys = function(download) {
        return ["title", "artist", "album", "year", "genre", "track", "art"].filter(function(key) {
            return !download.metadata.hasOwnProperty(key);
        });
    };

    $scope.addTmpMetadata = function(download) {
        download.metadata[download.metadataTmpKey] = download.metadataTmpValue;
        download.metadataTmpKey = undefined;
        download.metadataTmpValue = undefined;
        $scope.metadataChanged(download);
    };

    socket.on("download-updated", function(download) {
        $scope.$apply(function() {
            for (var i = 0; i < $scope.downloads.length; i++) {
                if ($scope.downloads[i]._id == download._id) {
                    if ($scope.downloads[i].status != "Ready" && download.status == "Ready" && $scope.notify) {
                        var options = {body: download.filename};
                        if (download.metadata.art) options.icon = download.metadata.art;
                        var notification = new Notification("Download ready", options);
                    }
                    //update properties rather than replacing object to keep inputs in focus
                    for (key in download) {
                        var value = download[key];
                        $scope.downloads[i][key] = value;
                    }
                    return;
                }
            }
            $scope.downloads.unshift(download);
        });
    });
}