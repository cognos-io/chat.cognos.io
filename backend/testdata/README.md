# Backend test data

Go and API tests create their own PocketBase records at runtime. There is no committed test database
or stable set of manual login credentials; fixture values are defined beside the tests that use
them.

To run a throwaway backend against `backend/testdata/pb_data`:

```sh
just backend-test
```

The automated API e2e suite starts from an isolated data directory and seeds fixtures itself:

```sh
just e2e-api
```
