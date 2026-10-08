-- @feature video

-- A video's media.url becomes its DIRECT LINK (/api/v1/video/<id>/file → a
-- plain MP4 for viewers with access) instead of the HLS master playlist, so
-- "Copy URL" gives a link that simply plays. Players still use HLS via the
-- playback endpoint.
UPDATE media
   SET url = regexp_replace(url, '/api/v1/video/([0-9a-f-]{36})/master\.m3u8$', '/api/v1/video/\1/file'),
       updated_at = NOW()
 WHERE url ~ '/api/v1/video/[0-9a-f-]{36}/master\.m3u8$';
