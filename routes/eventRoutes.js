const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const router = express.Router();
const { getSpotifyClient, getCurrentlyPlaying } = require('../middleware/spotify');

router.get('/:name', async (req, res) => {
  const hostName = req.params.name;

  try {
    const host = await prisma.user.findUnique({
      where: { name: hostName },
    });

    if (host) {
      const events = await prisma.event.findMany({
        where: { hostId: host.id },
        include: {
          host: true,
          playlist: {
            include: {
              queue: {
                include: {
                  Track: {
                    include: {
                      Album: true,
                      Artist: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (events.length > 0) {
        res.json(events);
      } else {
        res.status(404).json({ error: 'No events found for this host' });
      }
    } else {
      res.status(404).json({ error: 'Host not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:name/devices', getSpotifyClient, async (req, res) => {
  try {
    const devices = await req.spotifyClient.getMyDevices();

    if (devices.body.devices.length > 0) {
      res.json(devices.body.devices);
    } else {
      res.json({ message: 'No devices found for the user' });
    }
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});
router.get('/:name/pause', getSpotifyClient, async (req, res) => {
  try {
    await req.spotifyClient.pause();

    console.log('Playback paused successfully');
    return res.send('Playback paused successfully');
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

router.get('/:name/start', getSpotifyClient, async (req, res) => {
  const hostName = req.params.name;
  const deviceId = req.query.deviceId; // Extract deviceId from query parameter
  console.log(deviceId);

  try {
    const host = await prisma.user.findUnique({
      where: { name: hostName },
    });

    if (!host) {
      return res.status(404).json({ error: 'Host not found' });
    }

    const event = await prisma.event.findFirst({
      where: { hostId: host.id },
      include: { playlist: true },
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found for this host' });
    }

    const playlist = await prisma.playlist.findUnique({
      where: { id: event.playlistId },
      include: { queue: true },
    });

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found for this host' });
    }

    if (playlist.queue.length === 0) {
      return res.status(404).json({ error: 'Queue is empty' });
    }

    const firstSongInQueue = playlist.queue[0];

    const trackToPlay = `spotify:track:${firstSongInQueue.trackId}`;

    // Transfer playback to selected device
    await req.spotifyClient.transferMyPlayback([deviceId]);

    // Then start playing on the now active device
    await req.spotifyClient.play({
      uris: [trackToPlay],
      deviceId: deviceId,
    });

    await prisma.queue.update({
      where: { id: firstSongInQueue.id },
      data: { position: -firstSongInQueue.position },
    });

    res.send('Playing first track in queue successfully and removing it from the queue');
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

router.get('/:name/next', getSpotifyClient, async (req, res) => {
  const hostName = req.params.name;

  try {
    const host = await prisma.user.findUnique({
      where: { name: hostName },
    });

    if (!host) {
      return res.status(404).json({ error: 'Host not found' });
    }

    const event = await prisma.event.findFirst({
      where: { hostId: host.id },
      include: { playlist: true },
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found for this host' });
    }

    const playlist = await prisma.playlist.findUnique({
      where: { id: event.playlistId },
      include: {
        queue: {
          where: { position: { gt: 0 } },
        },
      },
    });

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found for this host' });
    }

    if (playlist.queue.length < 1) {
      return res.status(404).json({ error: 'Queue does not have next song' });
    }

    // Play the next song in the queue
    const nextSongInQueue = playlist.queue[0];

    const trackToPlay = `spotify:track:${nextSongInQueue.trackId}`;

    await req.spotifyClient.play({
      uris: [trackToPlay],
    });

    // Mark the current song as played by setting its position to a negative number
    await prisma.queue.update({
      where: { id: nextSongInQueue.id },
      data: { position: -Math.abs(nextSongInQueue.position) },
    });

    res.send('Playing next track in queue successfully');
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

router.get('/:name/now-playing', getSpotifyClient, async (req, res) => {
  try {
    const data = await req.spotifyClient.getMyCurrentPlaybackState();

    if (data.body && data.body.is_playing) {
      res.json(data.body);
    } else {
      res.json({ message: 'User is not playing anything, or playback is paused.' });
    }
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

router.get('/:name/resume', getSpotifyClient, async (req, res) => {
  try {
    await req.spotifyClient.play();

    console.log('Playback resumed successfully');
    return res.send('Playback resumed successfully');
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

router.get('/:name/history', async (req, res) => {
  const hostName = req.params.name;

  const host = await prisma.user.findUnique({
    where: { name: hostName },
  });

  if (!host) {
    return res.status(404).json({ error: 'Host not found' });
  }

  const event = await prisma.event.findFirst({
    where: { hostId: host.id },
    include: {
      playlist: true,
      playingTrack: {
        include: { Album: { include: { Artist: true } } },
      },
    },
  });

  const playlist = await prisma.playlist.findUnique({
    where: { id: event.playlistId },
    include: {
      queue: {
        where: { position: { lt: 0 } }, // Only include tracks with position > 0
        include: {
          Track: {
            include: {
              Album: true,
              Artist: true,
            },
          },
        },
      },
    },
  });

  if (!event) {
    return res.status(404).json({ error: 'Event not found for this host' });
  }

  res.json({ history: playlist.queue });
});

router.post('/:name/export', getSpotifyClient, async (req, res) => {
  const hostName = req.params.name;

  const host = await prisma.user.findUnique({
    where: { name: hostName },
  });

  if (!host) {
    return res.status(404).json({ error: 'Host not found' });
  }

  const event = await prisma.event.findFirst({
    where: { hostId: host.id },
    include: {
      playlist: true,
      playingTrack: {
        include: { Album: { include: { Artist: true } } },
      },
    },
  });

  if (!event) {
    return res.status(404).json({ error: 'Event not found for this host' });
  }

  const playlist = await prisma.playlist.findUnique({
    where: { id: event.playlistId },
    include: {
      queue: {
        where: { position: { lt: 0 } }, // Only include tracks with position > 0
        include: {
          Track: {
            include: {
              Album: true,
              Artist: true,
            },
          },
        },
      },
    },
  });

  // Generate list of Spotify track URIs
  const spotifyTrackURIs = playlist.queue.map((queueItem) => queueItem.Track.uri);

  try {
    // Create Spotify playlist
    const spotifyPlaylist = await req.spotifyClient.createPlaylist(`History for ${hostName}`, {
      public: false,
    });

    // Add tracks to the Spotify playlist
    await req.spotifyClient.addTracksToPlaylist(spotifyPlaylist.body.id, spotifyTrackURIs);

    res.json({
      message: 'Successfully exported history to Spotify playlist',
      spotifyPlaylist: spotifyPlaylist.body,
    });
  } catch (err) {
    console.error('Error creating Spotify playlist:', err);
    return res.status(500).json({ error: 'Error creating Spotify playlist' });
  }
});

router.get('/:name/playlist', async (req, res) => {
  try {
    const hostName = req.params.name;

    const host = await prisma.user.findUnique({
      where: { name: hostName },
    });

    if (!host) {
      return res.status(404).json({ error: 'Host not found' });
    }

    const event = await prisma.event.findFirst({
      where: { hostId: host.id },
      include: {
        playlist: true,
        playingTrack: {
          include: { Album: { include: { Artist: true } } },
        },
      },
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found for this host' });
    }

    if (!event.playlist || !event.playingTrack) {
      return res.status(404).json({ error: 'Playlist or Playing Track not found for this event' });
    }

    const playlist = await prisma.playlist.findUnique({
      where: { id: event.playlistId },
      include: {
        queue: {
          where: { position: { gte: 0 } },
          include: {
            Track: {
              include: {
                Album: true,
                Artist: true,
              },
            },
          },
        },
      },
    });

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    const currentlyPlaying = {
      name: event.playingTrack?.name,
      album: {
        name: event.playingTrack?.Album?.name,
      },
      artist: {
        name: event.playingTrack?.Album?.Artist?.name,
      },
    };

    res.json({ playlist: playlist, currentlyPlaying });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'An error occurred while processing your request' });
  }
});

router.post('/:username/playlist/reorder', async (req, res) => {
  const userName = req.params.username;
  const { fromIndex, toIndex } = req.body;

  const user = await prisma.user.findUnique({
    where: { name: userName },
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const event = await prisma.event.findFirst({
    where: { hostId: user.id },
  });

  if (!event) {
    return res.status(404).json({ error: 'Event not found for this user' });
  }

  const queueItems = await prisma.queue.findMany({
    where: { playlistId: event.playlistId },
    orderBy: { position: 'asc' },
  });

  if (
    fromIndex >= queueItems.length ||
    toIndex >= queueItems.length ||
    fromIndex < 0 ||
    toIndex < 0
  ) {
    res.status(400).json({ message: 'Invalid fromIndex or toIndex.' });
    return;
  }

  const [movedItem] = queueItems.splice(fromIndex, 1);
  queueItems.splice(toIndex, 0, movedItem);

  try {
    const trackUpdates = queueItems.map((item, index) =>
      prisma.queue.update({
        where: { id: item.id },
        data: { position: item.position < 0 ? item.position : index },
      }),
    );

    await prisma.$transaction(trackUpdates);

    return res.status(200).json({ message: 'Playlist reordered successfully.' });
  } catch (error) {
    return res
      .status(500)
      .json({ error: `An error occurred while updating the playlist: ${error.message}` });
  }
});

router.delete('/:name/songs/:id', getSpotifyClient, async (req, res) => {
  const hostName = req.params.name;
  const queueId = parseInt(req.params.id);

  const user = await prisma.user.findUnique({
    where: { name: hostName },
  });

  if (!user) {
    return res.status(404).send('User not found');
  }

  const event = await prisma.event.findFirst({
    where: { hostId: user.id },
  });

  if (!event) {
    return res.status(404).send('Event not found for this user');
  }

  const queueInPlaylist = await prisma.queue.findFirst({
    where: {
      playlistId: event.playlistId,
      id: queueId,
    },
  });

  if (!queueInPlaylist) {
    return res.status(404).send('Queue not found in the user playlist');
  }

  await prisma.queue.delete({
    where: {
      id: queueInPlaylist.id,
    },
  });

  res.status(200).send('Queue deleted successfully');
});

router.post('/:name/songs', getSpotifyClient, async (req, res) => {
  try {
    const { songID } = req.body;
    const hostName = req.params.name;

    const host = await prisma.user.findUnique({
      where: { name: hostName },
    });

    if (!host) {
      return res.status(404).json({ error: 'Host not found' });
    }

    const event = await prisma.event.findFirst({
      where: { hostId: host.id },
      include: { playlist: true },
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found for this host' });
    }

    const spotifyClient = req.spotifyClient;
    const trackData = await spotifyClient.getTrack(songID);

    if (!trackData.body) {
      return res.status(404).json({ error: 'Song not found in Spotify' });
    }

    const artistData = await spotifyClient.getArtist(trackData.body.artists[0].id);
    if (!artistData.body) {
      return res.status(404).json({ error: 'Artist not found in Spotify' });
    }

    const albumData = await spotifyClient.getAlbum(trackData.body.album.id);
    if (!albumData.body) {
      return res.status(404).json({ error: 'Album not found in Spotify' });
    }

    const artist = await prisma.artist.upsert({
      where: { id: artistData.body.id },
      update: {
        name: artistData.body.name,
        spotifyUrl: artistData.body.external_urls.spotify,
        href: artistData.body.href,
        artistType: artistData.body.type,
        uri: artistData.body.uri,
      },
      create: {
        id: artistData.body.id,
        name: artistData.body.name,
        spotifyUrl: artistData.body.external_urls.spotify,
        href: artistData.body.href,
        artistType: artistData.body.type,
        uri: artistData.body.uri,
      },
    });

    const album = await prisma.album.upsert({
      where: { id: albumData.body.id },
      update: {
        albumType: albumData.body.album_type,
        externalSpotifyUrl: albumData.body.external_urls.spotify,
        href: albumData.body.href,
        name: albumData.body.name,
        releaseDate: albumData.body.release_date,
        releaseDatePrecision: albumData.body.release_date_precision,
        totalTracks: albumData.body.total_tracks,
        uri: albumData.body.uri,
        artistId: artist.id,
      },
      create: {
        id: albumData.body.id,
        albumType: albumData.body.album_type,
        externalSpotifyUrl: albumData.body.external_urls.spotify,
        href: albumData.body.href,
        name: albumData.body.name,
        releaseDate: albumData.body.release_date,
        releaseDatePrecision: albumData.body.release_date_precision,
        totalTracks: albumData.body.total_tracks,
        uri: albumData.body.uri,
        artistId: artist.id,
      },
    });

    const track = await prisma.track.upsert({
      where: { id: trackData.body.id },
      update: {
        discNumber: trackData.body.disc_number,
        durationMs: trackData.body.duration_ms,
        explicit: trackData.body.explicit,
        isrc: trackData.body.external_ids.isrc,
        externalUrl: trackData.body.external_urls.spotify,
        href: trackData.body.href,
        isLocal: trackData.body.is_local,
        name: trackData.body.name,
        popularity: trackData.body.popularity,
        previewUrl: trackData.body.preview_url,
        trackNumber: trackData.body.track_number,
        trackType: trackData.body.type,
        uri: trackData.body.uri,
        artistId: artist.id,
        albumId: album.id,
      },
      create: {
        id: trackData.body.id,
        discNumber: trackData.body.disc_number,
        durationMs: trackData.body.duration_ms,
        explicit: trackData.body.explicit,
        isrc: trackData.body.external_ids.isrc,
        externalUrl: trackData.body.external_urls.spotify,
        href: trackData.body.href,
        isLocal: trackData.body.is_local,
        name: trackData.body.name,
        popularity: trackData.body.popularity,
        previewUrl: trackData.body.preview_url,
        trackNumber: trackData.body.track_number,
        trackType: trackData.body.type,
        uri: trackData.body.uri,
        artistId: artist.id,
        albumId: album.id,
      },
    });

    const queueItem = await prisma.queue.create({
      data: {
        position: (await prisma.queue.count()) + 1,
        playlistId: event.playlistId,
        trackId: track.id,
      },
    });

    const updatedEvent = await prisma.event.update({
      where: { id: event.id },
      data: {
        last_queue_item_added: new Date(),
      },
    });

    console.log('event', event.playlist.spotify_id);

    console.log('Song added successfully');
    return res.status(200).json({
      message: 'Song added successfully',
      queueItem: queueItem,
    });
  } catch (error) {
    console.error('An error occurred while adding the song:', error);
    return res.status(500).send('An error occurred while adding the song');
  }
});

router.get('/:name/tracks/:id', getSpotifyClient, async (req, res) => {
  const trackId = req.params.id;

  try {
    const data = await req.spotifyClient.getTrack(trackId);

    if (data.body) {
      res.json(data.body);
    } else {
      res.status(404).json({ message: 'Track not found.' });
    }
  } catch (err) {
    console.error('Something went wrong!', err);
    return res.status(500).send('Something went wrong');
  }
});

router.get('/:name/search/:query', getSpotifyClient, async (req, res) => {
  const query = req.params.query;

  try {
    const { body } = await req.spotifyClient.search(query, ['track', 'album', 'artist']);

    if (!body.tracks.total && !body.albums.total && !body.artists.total) {
      return res.status(404).send('No results found with the given query.');
    }

    res.json({
      tracks: body.tracks.items,
      albums: body.albums.items,
      artists: body.artists.items,
    });
  } catch (err) {
    console.error('Error searching for tracks, albums, or artists:', err);
    return res.status(500).send('Error searching for tracks, albums, or artists');
  }
});

module.exports = router;
