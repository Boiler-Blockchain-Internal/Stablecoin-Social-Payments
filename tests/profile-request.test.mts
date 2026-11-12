import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { requestProfile, ProfileRequestError, PROFILE_REQUEST_TIMEOUT_MS } from "../src/features/auth/profileRequest";

const user={id:"fixture",privy_id:"verified-user",username:"alice",wallet_address:null,created_at:"2026-11-11T00:00:00Z"};
afterEach(()=>{mock.restoreAll();mock.timers.reset();});
test("uses existing endpoint/token and sends only the chosen username",async()=>{
  mock.method(globalThis,"fetch",async(path:unknown,options:RequestInit)=>{
    assert.equal(path,"/api/users/username");
    assert.deepEqual(JSON.parse(options.body as string),{username:"alice"});
    assert.equal((options.headers as Record<string,string>).Authorization,"Bearer verified-token");
    return Response.json({user});
  });
  assert.deepEqual(await requestProfile("/api/users/username","verified-token",new AbortController().signal,"alice"),user);
});
test("response-body stalls are bounded, not just time until headers arrive",async()=>{
  mock.timers.enable({apis:["setTimeout"]});
  let headersReceived!:()=>void;
  const headers=new Promise<void>(resolve=>{headersReceived=resolve;});
  mock.method(globalThis,"fetch",async(_path:unknown,options:RequestInit)=>({
    ok:true,status:200,json:()=>{headersReceived();return new Promise((_resolve,reject)=>options.signal!.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError"))));},
  }));
  const result=requestProfile("/api/users/sync","token",new AbortController().signal);
  const rejection=assert.rejects(result,/took too long/);
  await headers;mock.timers.tick(PROFILE_REQUEST_TIMEOUT_MS);
  await rejection;
});
test("parent cancellation wins over late successful responses",async()=>{
  const parent=new AbortController();
  let resolve!: (value: Response)=>void;
  mock.method(globalThis,"fetch",()=>new Promise<Response>(done=>{resolve=done;}));
  const result=requestProfile("/api/users/sync","token",parent.signal);
  const rejection=assert.rejects(result,{name:"AbortError"});
  parent.abort();resolve(Response.json({user}));await rejection;
});
test("expired sessions and username conflicts are not automatically retried",async()=>{
  for(const status of [401,409]){
    mock.method(globalThis,"fetch",async()=>Response.json({error:"That username is already taken."},{status}));
    await assert.rejects(requestProfile("/api/users/username","token",new AbortController().signal,"alice"),error=>error instanceof ProfileRequestError && !error.retryable);
    mock.restoreAll();
  }
});
test("malformed responses and transport errors show safe actionable feedback",async()=>{
  for(const response of [Response.json({user:{username:"alice"}}),new Response("not JSON")]){
    mock.method(globalThis,"fetch",async()=>response);
    await assert.rejects(requestProfile("/api/users/sync","token",new AbortController().signal),/try again/);
    mock.restoreAll();
  }
  mock.method(globalThis,"fetch",async()=>{throw new Error("private endpoint detail");});
  await assert.rejects(requestProfile("/api/users/sync","token",new AbortController().signal),/Check your connection/);
});
test("non-JSON error pages are classified by status code",async()=>{
  mock.method(globalThis,"fetch",async()=>new Response("<html>Not Found</html>",{status:404}));
  await assert.rejects(requestProfile("/api/users/sync","token",new AbortController().signal),error=>error instanceof ProfileRequestError && !error.retryable);
  mock.restoreAll();
  mock.method(globalThis,"fetch",async()=>new Response("<html>Bad gateway</html>",{status:502}));
  await assert.rejects(requestProfile("/api/users/sync","token",new AbortController().signal),error=>error instanceof ProfileRequestError && error.retryable);
});
