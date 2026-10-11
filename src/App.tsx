import Workbench from './workspace/Workbench';
import { IS_WEBSITE } from './workspace/runtime';
import WebsiteWorkspace from './website/WebsiteWorkspace';

export default function App() {
  return IS_WEBSITE ? <WebsiteWorkspace /> : <Workbench />;
}
