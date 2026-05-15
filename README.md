docker-compose up -d --build waterdrop-local
docker-compose up -d --build waterdrop-dev
docker-compose up -d --build waterdrop-stg

docker-compose down
docker-compose logs -f waterdrop-dev
