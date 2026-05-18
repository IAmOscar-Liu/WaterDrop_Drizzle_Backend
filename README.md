docker-compose up -d --build waterdrop-local. --no-cache
docker-compose up -d --build waterdrop-dev --no-cache
docker-compose up -d --build waterdrop-stg --no-cache

docker-compose down
docker-compose logs -f waterdrop-dev
