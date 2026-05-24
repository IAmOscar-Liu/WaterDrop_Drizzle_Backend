docker-compose build --no-cache waterdrop-local && docker-compose up -d waterdrop-local
docker-compose build --no-cache waterdrop-dev && docker-compose up -d waterdrop-dev
docker-compose build --no-cache waterdrop-stg && docker-compose up -d waterdrop-stg

docker-compose down
docker-compose logs -f waterdrop-dev
