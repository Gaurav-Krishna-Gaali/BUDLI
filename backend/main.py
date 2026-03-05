# import asyncio
# import uuid
# from fastapi import FastAPI
# from browser_use_sdk import AsyncBrowserUse
# from pydantic import BaseModel

# app = FastAPI()

# client = AsyncBrowserUse()

# jobs = {}   # store job results


# class Devices(BaseModel):
#     Storage: str
#     Color: str
#     Condition: str
#     Price: str

# class DevicesList(BaseModel):
#     items: list[Devices]

# async def run_scrape(job_id, prompts, session_ids):
#     results = []

#     for prompt, session_id in zip(prompts, session_ids):
#         result = await client.run(
#             prompt,
#             session_id=session_id,
#             output_schema=DevicesList
#         )
#         results.append(result.output)

#     jobs[job_id]["results"] = results
#     jobs[job_id]["status"] = "finished"


# @app.post("/start")
# async def start_scraping():

#     prompts = [
#         "Go to https://ovantica.com/ and find all the prices for second hand Apple iPhone 16 Pro Max with the differ configs. Return a table of config and price and condition",
#         "Go to https://refitglobal.com/ and find all the prices for second hand Apple iPhone 15 Pro Max with the differ configs. Return a table of config and price and condition",
#         "Go to https://www.cashify.in/ and find all the prices for second hand Apple iPhone 14 Pro Max with the differ configs. Return a table of config and price and condition",
#     ]

#     job_id = str(uuid.uuid4())

#     sessions = []
#     live_urls = []

#     for _ in prompts:
#         session = await client.sessions.create()
#         sessions.append(session.id)
#         live_urls.append(session.live_url)

#     jobs[job_id] = {
#         "status": "running",
#         "results": None
#     }

#     asyncio.create_task(run_scrape(job_id, prompts, sessions))

#     return {
#         "job_id": job_id,
#         "live_urls": live_urls
#     }


# @app.get("/results/{job_id}")
# async def get_results(job_id: str):

#     job = jobs.get(job_id)

#     if not job:
#         return {"error": "job not found"}

#     return job







import asyncio
import uuid
from fastapi import FastAPI
from browser_use_sdk import AsyncBrowserUse
from pydantic import BaseModel

app = FastAPI()

client = AsyncBrowserUse()

jobs = {}   # store job results


class Devices(BaseModel):
    Storage: str
    Model: str
    Ram: str
    Color: str
    Condition: str
    Price: str


class DevicesList(BaseModel):
    items: list[Devices]


# run a single scrape
async def run_single(prompt, session_id):
    result = await client.run(
        prompt,
        session_id=session_id,
        output_schema=DevicesList
    )
    return result.output


# run all scrapes concurrently
async def run_scrape(job_id, prompts, session_ids):

    tasks = [
        asyncio.create_task(run_single(prompt, session_id))
        for prompt, session_id in zip(prompts, session_ids)
    ]

    results_list = await asyncio.gather(*tasks, return_exceptions=True)
    print(results_list)
    sources = ["ovantica", "refitglobal", "cashify"]
    results = {}
    for source, result in zip(sources, results_list):
        if isinstance(result, Exception):
            # handle exception, maybe set to empty list or error
            results[source] = []
        else:
            results[source] = result.items

    jobs[job_id]["results"] = results
    jobs[job_id]["status"] = "finished"


@app.post("/start")
async def start_scraping():

    prompts = [
        "Go to https://ovantica.com/ and find all the prices for second hand Apple iPhone 16 Pro Max with the differ configs. Return a table of config and price and condition",
        "Go to https://refitglobal.com/ and find all the prices for second hand Apple iPhone 15 Pro Max with the differ configs. Return a table of config and price and condition",
        "Go to https://www.cashify.in/ and find all the prices for second hand Apple iPhone 14 Pro Max with the differ configs. Return a table of config and price and condition",
    ]

    job_id = str(uuid.uuid4())

    sessions = []
    live_urls = []

    # create browser sessions
    for _ in prompts:
        session = await client.sessions.create()
        sessions.append(session.id)
        live_urls.append(session.live_url)

    jobs[job_id] = {
        "status": "running",
        "results": None
    }

    # run scraping in background
    asyncio.create_task(run_scrape(job_id, prompts, sessions))

    return {
        "job_id": job_id,
        "live_urls": live_urls
    }


@app.get("/results/{job_id}")
async def get_results(job_id: str):

    job = jobs.get(job_id)

    if not job:
        return {"error": "job not found"}

    return job