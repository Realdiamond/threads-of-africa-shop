-- UUIDv7 generator (time-ordered public ids). Postgres 16 has no built-in uuidv7():
-- take a random v4 uuid, overwrite its first 48 bits with the unix-ms timestamp and
-- flip the version nibble from 4 to 7.
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE sql VOLATILE AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid
$$;
