from langchain_ollama import ChatOllama
from langchain.agents import create_agent
from langchain_core.messages import HumanMessage

llm = ChatOllama(model="qwen2.5:7b", base_url="http://localhost:11434")
agent = create_agent(llm, tools=[])
inputs = {"messages": [HumanMessage(content="hello")]}

print("Invoking agent...")
for event in agent.stream(inputs, stream_mode="updates"):
    print("EVENT:", event)
print("Done!")
