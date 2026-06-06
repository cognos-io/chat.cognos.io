# Backend test data

## Test credentials

The API tests seed their own PocketBase records at runtime. No test database is committed.

| ID              | Username/Email        | Login Password | Vault Password                   | Verified |
| --------------- | --------------------- | -------------- | -------------------------------- | -------- |
| uvi8zmr78j9y5hz | <test1@example.com>   | password       | Eegev5eiyahjohghaingahtho8uxu3oh | ✅       |
| xq9ndvc2kbrvrng | <test2@example.com>   | password       | _not used in tests_              | ✅       |
| j8prcx3dum2l3kc | <no_data@example.com> | password       | _not used in tests_              | ✅       |

## Local scratch database

`make run/test` will start PocketBase with a local `testdata/pb_data` directory if you need a
throwaway manual sandbox, but the automated test suite now bootstraps from an empty data dir and
seeds its fixtures in code.
