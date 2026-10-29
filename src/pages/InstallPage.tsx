import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import InstallInstructions from '../components/InstallInstructions';

export default function InstallPage() {
  return (
    <div className="doc-page">
      <header className="doc-head"><Logo /></header>
      <main className="doc-body">
        <h1>Install TakeoffPro</h1>
        <InstallInstructions />
        <p><Link to="/">← Back</Link></p>
      </main>
    </div>
  );
}
