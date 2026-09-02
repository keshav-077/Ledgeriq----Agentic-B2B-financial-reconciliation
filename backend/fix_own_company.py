import asyncio
import motor.motor_asyncio
import os
from dotenv import load_dotenv
load_dotenv('.env')

async def fix():
    c = motor.motor_asyncio.AsyncIOMotorClient(os.getenv('MONGODB_URI'))
    db = c[os.getenv('MONGODB_DB_NAME', 'lumina_db')]
    cs = await db.company_settings.find_one({})
    own_name = cs.get('identity', {}).get('company_name', '') if cs else ''
    print(f'Own company from settings: {own_name}')
    r1 = await db.companies.update_many({}, {'$set': {'is_own_company': False}})
    print(f'Reset {r1.modified_count} companies')
    r2 = await db.companies.update_many({'name': own_name}, {'$set': {'is_own_company': True}})
    print(f'Marked as own: {r2.modified_count} company')
    c.close()

asyncio.run(fix())